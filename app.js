// app.js
(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let currentProfile = null; // { id, username, display_name, avatar_url, ... }
  let activeChatId = null;
  let usernameCheckTimer = null;
  let pendingAvatarFile = null;

  /* ---------------- theme (in-memory only for this session) ---------------- */
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }
  setTheme("light");
  $("#btn-theme-toggle")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    setTheme(current === "light" ? "dark" : "light");
  });

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------------- view switching ---------------- */
  function showAuth() {
    $("#view-app").classList.add("hidden");
    $("#view-auth").classList.remove("hidden");
  }
  function showApp() {
    $("#view-auth").classList.add("hidden");
    $("#view-app").classList.remove("hidden");
  }
  function showAuthCard(name) {
    ["login", "register", "forgot", "onboarding"].forEach((n) => {
      $(`#card-${n}`).classList.toggle("hidden", n !== name);
    });
  }
  function formMsg(id, text, type) {
    const el = $(id);
    el.textContent = text;
    el.className = "form-msg show " + type;
  }
  function clearFormMsg(id) {
    const el = $(id);
    el.className = "form-msg";
  }

  function initials(name) {
    if (!name) return "?";
    return name.trim().slice(0, 1).toUpperCase();
  }

  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.innerHTML = busy
      ? `<span class="btn-spinner"></span>`
      : label;
  }

  /* ---------------- auth card navigation ---------------- */
  $("#go-register").addEventListener("click", () => { clearFormMsg("#login-msg"); showAuthCard("register"); });
  $("#go-login").addEventListener("click", () => { clearFormMsg("#register-msg"); showAuthCard("login"); });
  $("#btn-show-forgot").addEventListener("click", () => { showAuthCard("forgot"); });
  $("#go-login-from-forgot").addEventListener("click", () => { showAuthCard("login"); });

  /* ---------------- login ---------------- */
  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormMsg("#login-msg");
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const btn = $("#btn-login");
    setBusy(btn, true, "Masuk");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(btn, false, "Masuk");
    if (error) {
      formMsg("#login-msg", error.message === "Invalid login credentials"
        ? "Email atau kata sandi salah."
        : error.message, "error");
      return;
    }
    // onAuthStateChange akan menangani transisi ke app / onboarding
  });

  /* ---------------- register ---------------- */
  $("#form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormMsg("#register-msg");
    const email = $("#register-email").value.trim();
    const password = $("#register-password").value;
    const btn = $("#btn-register");
    setBusy(btn, true, "Daftar");
    const { data, error } = await sb.auth.signUp({ email, password });
    setBusy(btn, false, "Daftar");
    if (error) {
      formMsg("#register-msg", error.message, "error");
      return;
    }
    if (!data.session) {
      formMsg("#register-msg", "Akun dibuat. Cek email kamu untuk konfirmasi, lalu masuk.", "success");
      return;
    }
    // sudah auto-login (email confirmation nonaktif) -> onAuthStateChange lanjut ke onboarding
  });

  /* ---------------- forgot password ---------------- */
  $("#form-forgot").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormMsg("#forgot-msg");
    const email = $("#forgot-email").value.trim();
    const btn = $("#btn-forgot");
    setBusy(btn, true, "Kirim tautan reset");
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href,
    });
    setBusy(btn, false, "Kirim tautan reset");
    if (error) {
      formMsg("#forgot-msg", error.message, "error");
      return;
    }
    formMsg("#forgot-msg", "Tautan reset kata sandi sudah dikirim ke emailmu.", "success");
  });

  /* ---------------- onboarding: avatar preview ---------------- */
  $("#onboarding-avatar-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    pendingAvatarFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      $("#onboarding-avatar-preview").innerHTML = `<img src="${reader.result}" alt="" />`;
    };
    reader.readAsDataURL(file);
  });

  /* ---------------- onboarding: username live check ---------------- */
  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
  $("#onboarding-username").addEventListener("input", (e) => {
    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    e.target.value = raw;
    const hint = $("#username-hint");
    const submitBtn = $("#btn-onboarding");
    submitBtn.disabled = true;

    if (!raw) { hint.textContent = ""; hint.className = "hint"; return; }
    if (!USERNAME_RE.test(raw)) {
      hint.textContent = "3-20 karakter, huruf kecil/angka/underscore saja.";
      hint.className = "hint bad";
      return;
    }
    hint.textContent = "Mengecek ketersediaan...";
    hint.className = "hint";

    clearTimeout(usernameCheckTimer);
    usernameCheckTimer = setTimeout(async () => {
      const { data, error } = await sb.rpc("is_username_available", { check_username: raw });
      if (e.target.value !== raw) return; // input berubah lagi, abaikan hasil basi
      if (error) {
        hint.textContent = "Gagal mengecek username.";
        hint.className = "hint bad";
        return;
      }
      if (data) {
        hint.textContent = "Username tersedia.";
        hint.className = "hint ok";
        submitBtn.disabled = false;
      } else {
        hint.textContent = "Username sudah dipakai.";
        hint.className = "hint bad";
      }
    }, 400);
  });

  /* ---------------- onboarding: submit ---------------- */
  $("#form-onboarding").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormMsg("#onboarding-msg");
    const btn = $("#btn-onboarding");
    const username = $("#onboarding-username").value.trim();
    const displayName = $("#onboarding-name").value.trim();

    const { data: { user } } = await sb.auth.getUser();
    if (!user) { formMsg("#onboarding-msg", "Sesi tidak ditemukan, coba masuk ulang.", "error"); return; }

    setBusy(btn, true, "Simpan &amp; mulai ngobrol");

    let avatarUrl = null;
    if (pendingAvatarFile) {
      const ext = pendingAvatarFile.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, pendingAvatarFile, { upsert: true });
      if (upErr) {
        setBusy(btn, false, "Simpan &amp; mulai ngobrol");
        formMsg("#onboarding-msg", "Gagal mengunggah foto: " + upErr.message, "error");
        return;
      }
      const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
      avatarUrl = pub.publicUrl;
    }

    const { data: profile, error } = await sb
      .from("profiles")
      .upsert({
        id: user.id,
        username,
        display_name: displayName,
        avatar_url: avatarUrl,
      })
      .select()
      .single();

    setBusy(btn, false, "Simpan &amp; mulai ngobrol");

    if (error) {
      formMsg("#onboarding-msg", error.message.includes("duplicate")
        ? "Username baru saja dipakai orang lain, coba yang lain."
        : error.message, "error");
      return;
    }

    currentProfile = profile;
    await enterApp();
  });

  /* ---------------- profile menu ---------------- */
  $("#btn-open-profile-menu").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#profile-menu").classList.toggle("hidden");
  });
  document.addEventListener("click", () => $("#profile-menu").classList.add("hidden"));
  $("#menu-logout").addEventListener("click", async () => {
    await sb.auth.signOut();
  });
  $("#menu-settings").addEventListener("click", () => {
    toast("Halaman Pengaturan lengkap menyusul di fase berikutnya.");
    $("#profile-menu").classList.add("hidden");
  });
  $("#btn-notifications").addEventListener("click", () => {
    toast("Pusat notifikasi menyusul di fase berikutnya.");
  });

  /* ---------------- mobile back button ---------------- */
  function goMobileList() {
    $("#view-app").setAttribute("data-mobile-view", "list");
  }
  function goMobileChat() {
    $("#view-app").setAttribute("data-mobile-view", "chat");
  }

  /* ---------------- render sidebar profile ---------------- */
  function renderMyIdentity() {
    if (!currentProfile) return;
    const label = currentProfile.display_name || currentProfile.username || "?";
    const avatarHtml = currentProfile.avatar_url
      ? `<img src="${currentProfile.avatar_url}" alt="" />`
      : initials(label);
    $("#my-avatar").innerHTML = avatarHtml;
    $("#my-story-avatar").innerHTML = avatarHtml;
  }

  /* ---------------- chat list ---------------- */
  async function loadChatList() {
    const { data: myChats, error } = await sb
      .from("chat_participants")
      .select("chat_id")
      .eq("profile_id", currentProfile.id);

    if (error) { console.error(error); return; }
    const chatIds = myChats.map((c) => c.chat_id);
    const listEl = $("#chat-list");

    if (!chatIds.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <h3>Belum ada obrolan</h3>
          <p>Cari username di atas untuk mulai percakapan pertamamu.</p>
        </div>`;
      return;
    }

    const { data: chats } = await sb
      .from("chats")
      .select("id, is_group, name, chat_participants(profile_id, profiles(id, username, display_name, avatar_url))")
      .in("id", chatIds);

    listEl.innerHTML = "";
    (chats || []).forEach((chat) => {
      const other = (chat.chat_participants || [])
        .map((p) => p.profiles)
        .find((p) => p && p.id !== currentProfile.id);
      const label = chat.is_group ? (chat.name || "Grup") : (other?.display_name || other?.username || "Pengguna");
      const avatarHtml = other?.avatar_url ? `<img src="${other.avatar_url}" alt="" />` : initials(label);

      const row = document.createElement("button");
      row.className = "icon-btn";
      row.style.cssText = "width:100%;height:auto;border-radius:12px;display:flex;align-items:center;gap:12px;padding:10px 10px;justify-content:flex-start;text-align:left;";
      row.innerHTML = `
        <span class="avatar">${avatarHtml}</span>
        <span style="min-width:0;flex:1;">
          <span style="display:block;font-weight:600;font-size:14.5px;color:var(--ink);">${label}</span>
          <span style="display:block;font-size:12.5px;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Ketuk untuk membuka</span>
        </span>`;
      row.addEventListener("click", () => openChat(chat.id, label, other));
      listEl.appendChild(row);
    });
  }

  /* ---------------- open a chat ---------------- */
  async function openChat(chatId, label, other) {
    activeChatId = chatId;
    goMobileChat();
    const avatarHtml = other?.avatar_url ? `<img src="${other.avatar_url}" alt="" />` : initials(label);

    const pane = $("#chat-pane");
    pane.innerHTML = `
      <div class="chat-header">
        <button class="icon-btn back-btn" id="btn-back-list" aria-label="Kembali">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span class="avatar">${avatarHtml}</span>
        <span class="who">
          <span class="name">${label}</span>
          <span class="status">${other?.username ? "@" + other.username : ""}</span>
        </span>
      </div>
      <div class="messages-scroll" id="messages-scroll"></div>
      <div class="composer">
        <textarea id="composer-input" rows="1" placeholder="Tulis pesan..."></textarea>
        <button class="send-btn" id="btn-send" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
        </button>
      </div>`;

    $("#btn-back-list").addEventListener("click", goMobileList);

    const input = $("#composer-input");
    const sendBtn = $("#btn-send");
    input.addEventListener("input", () => { sendBtn.disabled = !input.value.trim(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim()) sendMessage();
      }
    });
    sendBtn.addEventListener("click", sendMessage);

    await loadMessages(chatId);
  }

  async function loadMessages(chatId) {
    const { data: messages, error } = await sb
      .from("messages")
      .select("id, sender_id, type, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });

    const scroll = $("#messages-scroll");
    if (!scroll) return;
    if (error) { scroll.innerHTML = `<div class="empty-state"><p>Gagal memuat pesan.</p></div>`; return; }

    if (!messages.length) {
      scroll.innerHTML = `<div class="empty-state"><p>Belum ada pesan. Mulai percakapan!</p></div>`;
      return;
    }
    scroll.innerHTML = messages.map(renderBubble).join("");
    scroll.scrollTop = scroll.scrollHeight;
  }

  function renderBubble(msg) {
    const mine = msg.sender_id === currentProfile.id;
    const time = new Date(msg.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return `
      <div style="display:flex;justify-content:${mine ? "flex-end" : "flex-start"};margin-bottom:8px;">
        <div style="max-width:65%;background:${mine ? "var(--brand)" : "var(--surface)"};color:${mine ? "#fff" : "var(--ink)"};
                    padding:9px 13px;border-radius:16px;${mine ? "border-bottom-right-radius:4px;" : "border-bottom-left-radius:4px;"}
                    box-shadow:var(--shadow-sm);font-size:14.5px;line-height:1.4;">
          ${escapeHtml(msg.content || "")}
          <div style="font-size:10.5px;opacity:0.7;margin-top:4px;text-align:right;">${time}</div>
        </div>
      </div>`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function sendMessage() {
    const input = $("#composer-input");
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    $("#btn-send").disabled = true;

    const { error } = await sb.from("messages").insert({
      chat_id: activeChatId,
      sender_id: currentProfile.id,
      type: "text",
      content: text,
    });
    if (error) { toast("Gagal mengirim pesan."); return; }
    await loadMessages(activeChatId);
  }

  /* ---------------- username search -> start chat ---------------- */
  let searchTimer = null;
  $("#search-input").addEventListener("input", (e) => {
    const q = e.target.value.trim().replace(/^@/, "");
    clearTimeout(searchTimer);
    const resultsEl = $("#search-results");
    if (!q) { resultsEl.innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      const { data: users, error } = await sb
        .from("profiles")
        .select("id, username, display_name, avatar_url, is_online")
        .ilike("username", `%${q}%`)
        .neq("id", currentProfile.id)
        .limit(6);
      if (error) return;
      if (!users.length) {
        resultsEl.innerHTML = `<div style="padding:10px 4px;font-size:13px;color:var(--ink-soft);">Tidak ada pengguna ditemukan.</div>`;
        return;
      }
      resultsEl.innerHTML = users.map((u) => `
        <button data-uid="${u.id}" class="icon-btn" style="width:100%;height:auto;border-radius:10px;display:flex;align-items:center;gap:10px;padding:8px;justify-content:flex-start;text-align:left;">
          <span class="avatar" style="width:34px;height:34px;font-size:13px;">${u.avatar_url ? `<img src="${u.avatar_url}"/>` : initials(u.display_name || u.username)}</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-size:13.5px;font-weight:600;">${u.display_name || u.username}</span>
            <span style="display:block;font-size:12px;color:var(--ink-soft);">@${u.username}</span>
          </span>
        </button>`).join("");
      resultsEl.querySelectorAll("button[data-uid]").forEach((btn) => {
        btn.addEventListener("click", () => startChatWith(btn.getAttribute("data-uid")));
      });
    }, 300);
  });

  async function startChatWith(otherId) {
    // cari conversation yang sudah ada di antara kedua user
    const { data: myChats } = await sb.from("chat_participants").select("chat_id").eq("profile_id", currentProfile.id);
    const myChatIds = (myChats || []).map((c) => c.chat_id);
    let existingChatId = null;
    if (myChatIds.length) {
      const { data: shared } = await sb
        .from("chat_participants")
        .select("chat_id")
        .eq("profile_id", otherId)
        .in("chat_id", myChatIds);
      if (shared && shared.length) existingChatId = shared[0].chat_id;
    }

    let chatId = existingChatId;
    if (!chatId) {
      const { data: newChat, error } = await sb
        .from("chats")
        .insert({ is_group: false, created_by: currentProfile.id })
        .select()
        .single();
      if (error) { toast("Gagal membuat obrolan."); return; }
      chatId = newChat.id;
      await sb.from("chat_participants").insert([
        { chat_id: chatId, profile_id: currentProfile.id },
        { chat_id: chatId, profile_id: otherId },
      ]);
    }

    $("#search-input").value = "";
    $("#search-results").innerHTML = "";
    await loadChatList();

    const { data: other } = await sb.from("profiles").select("id, username, display_name, avatar_url").eq("id", otherId).single();
    openChat(chatId, other?.display_name || other?.username || "Pengguna", other);
  }

  /* ---------------- entering the app after auth ---------------- */
  async function enterApp() {
    renderMyIdentity();
    showApp();
    goMobileList();
    await loadChatList();
  }

  async function loadOrCreateProfileFlow(user) {
    const { data: profile, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) { console.error(error); return; }

    if (!profile) {
      showAuth();
      showAuthCard("onboarding");
      $("#onboarding-avatar-preview").textContent = "?";
      return;
    }
    currentProfile = profile;
    await enterApp();
  }

  /* ---------------- auth state ---------------- */
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      currentProfile = null;
      activeChatId = null;
      showAuth();
      showAuthCard("login");
      return;
    }
    await loadOrCreateProfileFlow(session.user);
  });

  // cek sesi awal saat halaman dimuat (session persistence)
  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await loadOrCreateProfileFlow(session.user);
    } else {
      showAuth();
      showAuthCard("login");
    }
  })();
})();
