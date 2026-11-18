
// ============================================
// SUPPORTDESK LIVE
// Guest Chat + Single Administrator Dashboard
// ============================================

const SUPABASE_URL =
  "https://keknignerubsxxtzvrog.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_8WKlYGyXbxb33SoWmtMXtw_9bC8pxVW";

const configured = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  window.supabase
);

const db = configured
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    )
  : null;

const $ = id => document.getElementById(id);

const screens = [
  "welcome",
  "chat",
  "staff-login",
  "inbox"
];

function show(id) {
  screens.forEach(screen => {
    const el = $(screen);
    if (el) el.classList.toggle("hidden", screen !== id);
  });
}

let conversationId = null;
let currentUser = null;
let selectedConversation = null;
let messageChannel = null;
let listChannel = null;

let guestName = "";


// ============================================
// GENERAL HELPERS
// ============================================

function setBusy(button, busy, text) {
  if (!button) return;

  button.disabled = busy;

  if (busy) {
    button.dataset.originalText =
      button.textContent;
    button.textContent = text || "Please wait...";
  } else {
    button.textContent =
      button.dataset.originalText || "Send";
  }
}

function addBubble(
  container,
  body,
  mine = false,
  bot = false,
  time = new Date()
) {
  if (!container) return;

  const bubble = document.createElement("div");

  bubble.className =
    "bubble" +
    (mine ? " mine" : "") +
    (bot ? " bot" : "");

  const text = document.createElement("div");
  text.textContent = body;

  const meta = document.createElement("small");

  const sender = bot
    ? "Automated assistant"
    : mine
      ? "You"
      : "Support team";

  meta.textContent =
    sender +
    " · " +
    new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

  bubble.append(text, meta);
  container.append(bubble);

  container.scrollTop = container.scrollHeight;
}

function showError(elementId, message) {
  const el = $(elementId);
  if (el) el.textContent = message;
}


// ============================================
// GUEST AUTHENTICATION
// ============================================

async function ensureGuest() {
  const {
    data: { session },
    error
  } = await db.auth.getSession();

  if (error) throw error;

  // Never use an administrator session as a guest.
  if (session && !session.user.is_anonymous) {
    await db.auth.signOut();
  }

  const {
    data,
    error: signInError
  } = await db.auth.signInAnonymously();

  if (signInError) throw signInError;

  if (!data.user || !data.user.is_anonymous) {
    throw new Error(
      "Unable to establish a guest session."
    );
  }

  return data.user;
}


// ============================================
// LOAD CHAT MESSAGES
// ============================================

async function loadMessages(
  id,
  target,
  guest = true
) {
  if (!id || !target) return;

  target.innerHTML = "";

  const { data, error } = await db
    .from("messages")
    .select(
      "id,body,sender_id,sender_role,visibility,created_at"
    )
    .eq("conversation_id", id)
    .eq("visibility", "public")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  data.forEach(message => {
    addBubble(
      target,
      message.body,
      guest
        ? message.sender_role === "customer"
        : message.sender_role !== "customer" &&
          message.sender_role !== "bot",
      message.sender_role === "bot",
      message.created_at
    );
  });

  if (messageChannel) {
    await db.removeChannel(messageChannel);
  }

  messageChannel = db
    .channel("messages-" + id)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: "conversation_id=eq." + id
      },
      payload => {
        const message = payload.new;

        if (message.visibility !== "public") return;

        addBubble(
          target,
          message.body,
          guest
            ? message.sender_role === "customer"
            : message.sender_role !== "customer" &&
              message.sender_role !== "bot",
          message.sender_role === "bot",
          message.created_at
        );
      }
    )
    .subscribe();
}


// ============================================
// GUEST START CONVERSATION
// ============================================

if ($("guest-form")) {
  $("guest-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (!configured) {
        alert("Supabase is not configured.");
        return;
      }

      const button = $("guest-form")
        .querySelector('button[type="submit"]');

      setBusy(button, true, "Starting...");

      try {
        currentUser = await ensureGuest();

        const name =
          $("guest-name").value.trim();

        const email =
          $("guest-email").value.trim();

        const topic = "Open conversation";

        if (!name || !email) {
          throw new Error(
            "Please enter your name and email."
          );
        }

        guestName = name;

        const { error: profileError } = await db
          .from("guest_profiles")
          .upsert(
            {
              user_id: currentUser.id,
              full_name: name,
              email: email,
              topic: topic
            },
            {
              onConflict: "user_id"
            }
          );

        if (profileError) throw profileError;

        const {
          data: conversation,
          error
        } = await db.rpc(
          "create_guest_conversation",
          {
            p_subject: topic
          }
        );

        if (error) throw error;

        conversationId = conversation;

        sessionStorage.setItem(
          "supportdesk_conversation",
          conversationId
        );

        show("chat");

        if ($("chat-subtitle")) {
          $("chat-subtitle").textContent =
            "Conversation started for " + name;
        }

        await loadMessages(
          conversationId,
          $("messages"),
          true
        );

        addBubble(
          $("messages"),
          "Hello " + name +
          "! Welcome to SupportDesk Live. " +
          "How may I assist you today?",
          false,
          true
        );

      } catch (error) {
        alert(
          "Unable to start chat: " +
          error.message
        );
      } finally {
        setBusy(button, false);
      }
    }
  );
}


// ============================================
// GUEST SEND MESSAGE
// Uses secure Supabase RPC
// ============================================

if ($("message-form")) {
  $("message-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const input = $("message-input");
      const body = input.value.trim();

      if (!body || !conversationId || !currentUser) {
        return;
      }

      if (body.length > 10000) {
        alert("Please keep your message under 10,000 characters.");
        return;
      }

      const button = $("message-form")
        .querySelector('button[type="submit"]');

      setBusy(button, true, "Sending...");

      try {
        const { error } = await db.rpc(
          "guest_send_message",
          {
            p_conversation_id: conversationId,
            p_body: body
          }
        );

        if (error) throw error;

        input.value = "";
        if ($("message-count")) {
          $("message-count").textContent = "0 / 10,000 characters";
        }

      } catch (error) {
        alert(
          "Message not sent: " +
          error.message
        );
      } finally {
        setBusy(button, false);
      }
    }
  );
}


// Live character count for the open guest message composer.
if ($("message-input") && $("message-count")) {
  const updateMessageCount = () => {
    $("message-count").textContent =
      $("message-input").value.length.toLocaleString() +
      " / 10,000 characters";
  };
  $("message-input").addEventListener("input", updateMessageCount);
  updateMessageCount();
}


// ============================================
// QUICK FAQ BUTTONS
// ============================================

document
  .querySelectorAll("[data-faq]")
  .forEach(button => {
    button.addEventListener("click", () => {

      const questions = {
        hours: "What are your support hours?",
        billing:
          "I need help with billing or payment.",
        account:
          "I need help with my account."
      };

      const input = $("message-input");

      if (!input) return;

      input.value =
        questions[button.dataset.faq] || "";

      input.focus();
    });
  });


// ============================================
// ADMIN LOGIN
// Only active administrator is allowed
// ============================================

if ($("staff-form")) {
  $("staff-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (!configured) {
        showError(
          "staff-error",
          "Supabase is not configured."
        );
        return;
      }

      const button = $("staff-form")
        .querySelector('button[type="submit"]');

      setBusy(button, true, "Signing in...");

      try {
        const {
          data,
          error
        } = await db.auth.signInWithPassword({
          email: $("staff-email").value.trim(),
          password: $("staff-password").value
        });

        if (error) throw error;

        const {
          data: profile,
          error: profileError
        } = await db
          .from("staff_profiles")
          .select(
            "display_name,role,active"
          )
          .eq("user_id", data.user.id)
          .single();

        if (
          profileError ||
          !profile ||
          profile.active !== true ||
          profile.role !== "admin"
        ) {
          await db.auth.signOut();

          throw new Error(
            "Only the active administrator can log in."
          );
        }

        currentUser = data.user;

        show("inbox");

        if ($("staff-identity")) {
          $("staff-identity").textContent =
            profile.display_name +
            " · Administrator";
        }

        await loadInbox();

      } catch (error) {
        showError(
          "staff-error",
          error.message
        );
      } finally {
        setBusy(button, false);
      }
    }
  );
}


// ============================================
// ADMIN CONVERSATION INBOX
// No foreign-key join required
// ============================================

async function loadInbox() {
  if (!db) return;

  const list = $("conversation-list");

  if (!list) return;

  list.textContent = "Loading conversations...";

  const {
    data: conversations,
    error
  } = await db
    .from("conversations")
    .select(
      "id,guest_user_id,subject,status,created_at,updated_at"
    )
    .in(
      "status",
      ["queued", "open", "pending"]
    )
    .order(
      "updated_at",
      { ascending: false }
    )
    .limit(50);

  if (error) {
    list.textContent = error.message;
    return;
  }

  const guestIds = [
    ...new Set(
      conversations
        .map(item => item.guest_user_id)
        .filter(Boolean)
    )
  ];

  let guests = [];

  if (guestIds.length) {
    const result = await db
      .from("guest_profiles")
      .select(
        "user_id,full_name,email"
      )
      .in("user_id", guestIds);

    if (result.error) {
      list.textContent = result.error.message;
      return;
    }

    guests = result.data || [];
  }

  const guestMap = new Map(
    guests.map(guest => [
      guest.user_id,
      guest
    ])
  );

  list.innerHTML = "";

  conversations.forEach(conversation => {
    const guest =
      guestMap.get(conversation.guest_user_id) || {};

    const item = document.createElement("button");

    item.className = "conversation-item";

    const title = document.createElement("b");

    title.textContent =
      guest.full_name || "Guest";

    const subtitle = document.createElement("small");

    subtitle.textContent =
      (conversation.subject || "Support") +
      " · " +
      conversation.status;

    item.append(title, subtitle);

    item.addEventListener("click", () => {
      openAgentConversation({
        ...conversation,
        guest_profiles: guest
      });
    });

    list.append(item);
  });

  if (!conversations.length) {
    list.textContent =
      "No active conversations.";
  }

  if (listChannel) {
    await db.removeChannel(listChannel);
  }

  listChannel = db
    .channel("conversation-list")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "conversations"
      },
      () => {
        loadInbox();
      }
    )
    .subscribe();
}


// ============================================
// ADMIN OPEN CONVERSATION
// ============================================

async function openAgentConversation(conversation) {
  selectedConversation = conversation;

  const guest =
    conversation.guest_profiles || {};

  if ($("agent-thread-title")) {
    $("agent-thread-title").textContent =
      (guest.full_name || "Guest") +
      " · " +
      (guest.email || "");
  }

  if ($("resolve-chat")) {
    $("resolve-chat").disabled = false;
  }

  if ($("take-chat")) {
    $("take-chat").disabled = true;
    $("take-chat").classList.add("hidden");
  }

  const target = $("agent-messages");

  if (!target) return;

  target.innerHTML = "Loading messages...";

  const {
    data,
    error
  } = await db
    .from("messages")
    .select(
      "id,body,sender_role,visibility,created_at"
    )
    .eq(
      "conversation_id",
      conversation.id
    )
    .order("created_at", {
      ascending: true
    })
    .limit(100);

  if (error) {
    target.textContent = error.message;
    return;
  }

  target.innerHTML = "";

  data.forEach(message => {
    if (
      message.visibility !== "public" &&
      message.visibility !== "internal"
    ) {
      return;
    }

    addBubble(
      target,
      message.visibility === "internal"
        ? "[INTERNAL NOTE] " + message.body
        : message.body,
      message.sender_role !== "customer" &&
      message.sender_role !== "bot",
      message.sender_role === "bot",
      message.created_at
    );
  });

  if (messageChannel) {
    await db.removeChannel(messageChannel);
  }

  messageChannel = db
    .channel("admin-messages-" + conversation.id)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter:
          "conversation_id=eq." +
          conversation.id
      },
      payload => {
        const message = payload.new;

        if (
          message.visibility !== "public" &&
          message.visibility !== "internal"
        ) return;

        addBubble(
          target,
          message.visibility === "internal"
            ? "[INTERNAL NOTE] " + message.body
            : message.body,
          message.sender_role !== "customer" &&
          message.sender_role !== "bot",
          message.sender_role === "bot",
          message.created_at
        );
      }
    )
    .subscribe();
}


// ============================================
// ADMIN SEND REPLY
// Uses secure administrator RPC
// ============================================

if ($("agent-message-form")) {
  $("agent-message-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (!selectedConversation || !currentUser) {
        return;
      }

      const input = $("agent-message-input");
      const body = input.value.trim();

      if (!body) return;

      const button = $("agent-message-form")
        .querySelector('button[type="submit"]');

      setBusy(button, true, "Sending...");

      try {
        const { error } = await db.rpc(
          "admin_send_reply",
          {
            p_conversation_id:
              selectedConversation.id,
            p_body: body
          }
        );

        if (error) throw error;

        input.value = "";

      } catch (error) {
        alert(
          "Reply not sent: " +
          error.message
        );
      } finally {
        setBusy(button, false);
      }
    }
  );
}


// ============================================
// ADMIN RESOLVE CONVERSATION
// ============================================

if ($("resolve-chat")) {
  $("resolve-chat").addEventListener(
    "click",
    async () => {
      if (!selectedConversation) return;

      const { error } = await db.rpc(
        "admin_resolve_conversation",
        {
          p_conversation_id:
            selectedConversation.id
        }
      );

      if (error) {
        alert(
          "Unable to resolve: " +
          error.message
        );
        return;
      }

      selectedConversation = null;

      if ($("agent-thread-title")) {
        $("agent-thread-title").textContent =
          "Conversation resolved";
      }

      if ($("agent-messages")) {
        $("agent-messages").innerHTML = "";
      }

      await loadInbox();
    }
  );
}


// ============================================
// ADMIN SIGN OUT
// ============================================

if ($("signout")) {
  $("signout").addEventListener(
    "click",
    async () => {
      if (messageChannel) {
        await db.removeChannel(messageChannel);
        messageChannel = null;
      }

      if (listChannel) {
        await db.removeChannel(listChannel);
        listChannel = null;
      }

      await db.auth.signOut();

      currentUser = null;
      selectedConversation = null;

      show("staff-login");
    }
  );
}


// ============================================
// PAGE ROUTING
// Guest: /
// Admin: /#agent
// ============================================

function routePage() {
  if (location.hash === "#agent") {
    show("staff-login");
  } else {
    show("welcome");
  }
}

window.addEventListener(
  "hashchange",
  routePage
);

routePage();

if (!configured) {
  const note = $("setup-note");

  if (note) {
    note.textContent =
      "Supabase connection is unavailable. Check your configuration.";
  }
}

console.log(
  "SupportDesk Live initialized."
);
