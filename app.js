
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
let attachmentChannel = null;
let guestConversationChannel = null;
let selectedGuestRating = 0;

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
      : "SupportDesk Team";

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
// PRIVATE CONVERSATION ATTACHMENTS
// Files are stored in a private bucket. Access is
// controlled by Supabase Storage RLS and signed URLs.
// ============================================

const ATTACHMENT_BUCKET = "supportdesk-attachments";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);

function formatFileSize(bytes) {
  return bytes < 1024 * 1024
    ? Math.max(1, Math.round(bytes / 1024)) + " KB"
    : (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "attachment";
}

async function loadAttachments(id, target) {
  if (!id || !target) return;
  target.textContent = "Loading files…";

  const { data, error } = await db
    .from("conversation_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,sender_role,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    target.textContent = "Unable to load attachments: " + error.message;
    return;
  }

  target.innerHTML = "";
  if (!data || !data.length) {
    target.textContent = "No files shared yet.";
    target.classList.add("muted");
    return;
  }
  target.classList.remove("muted");

  for (const file of data) {
    const { data: signed, error: urlError } = await db.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(file.storage_path, 300);
    if (urlError || !signed?.signedUrl) continue;

    const card = document.createElement("div");
    card.className = "attachment-card";
    if (file.mime_type && file.mime_type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = signed.signedUrl;
      img.alt = file.file_name;
      img.loading = "lazy";
      card.append(img);
    }
    const details = document.createElement("div");
    const link = document.createElement("a");
    link.href = signed.signedUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = file.file_name;
    const meta = document.createElement("small");
    meta.textContent = formatFileSize(file.size_bytes) + " · " +
      (file.sender_role === "admin" ? "SupportDesk Team" : "Customer");
    details.append(link, meta);
    card.append(details);
    target.append(card);
  }
}

async function uploadConversationAttachment(file, role, id, statusElement) {
  if (!file || !id || !currentUser) return;
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new Error("File type not allowed. Choose JPG, PNG, WEBP, PDF, DOC, DOCX, or TXT.");
  }
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("File must be no larger than 5 MB.");
  }

  if (statusElement) statusElement.textContent = "Uploading " + file.name + "…";
  const unique = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const path = id + "/" + unique + "-" + safeFileName(file.name);

  const { error: uploadError } = await db.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await db
    .from("conversation_attachments")
    .insert({
      conversation_id: id,
      uploaded_by: currentUser.id,
      sender_role: role,
      file_name: file.name.slice(0, 255),
      mime_type: file.type,
      size_bytes: file.size,
      storage_path: path
    });

  if (metadataError) {
    await db.storage.from(ATTACHMENT_BUCKET).remove([path]);
    throw metadataError;
  }

  if (statusElement) statusElement.textContent = "File shared successfully.";
  await loadAttachments(id, $(role === "admin" ? "admin-attachments" : "guest-attachments"));
}

function watchAttachments(id, target) {
  if (attachmentChannel) db.removeChannel(attachmentChannel);
  attachmentChannel = db
    .channel("attachments-" + id)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "conversation_attachments",
      filter: "conversation_id=eq." + id
    }, () => loadAttachments(id, target))
    .subscribe();
}

function wireAttachmentPicker(inputId, role, targetId, statusId) {
  const input = $(inputId);
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const id = role === "admin" ? selectedConversation?.id : conversationId;
    try {
      await uploadConversationAttachment(file, role, id, $(statusId));
    } catch (error) {
      alert("Attachment not sent: " + error.message);
      if ($(statusId)) $(statusId).textContent = "Upload failed.";
    } finally {
      input.value = "";
    }
  });
}

wireAttachmentPicker("guest-file", "customer", "guest-attachments", "guest-upload-status");
wireAttachmentPicker("admin-file", "admin", "admin-attachments", "admin-upload-status");

// ============================================
// CUSTOMER SATISFACTION (GUEST)
// Ratings are available only after a conversation is resolved.
// ============================================
const ratingLabels = {
  1: "Poor", 2: "Fair", 3: "Okay", 4: "Good", 5: "Excellent"
};

function setGuestRating(value) {
  selectedGuestRating = value;
  document.querySelectorAll("#guest-rating-stars [data-rating]").forEach(button => {
    const active = Number(button.dataset.rating) <= value;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(Number(button.dataset.rating) === value));
  });
  if ($("guest-rating-label")) $("guest-rating-label").textContent = ratingLabels[value] || "Select a rating";
  if ($("submit-guest-rating")) $("submit-guest-rating").disabled = !value;
}

async function refreshGuestRatingState(id) {
  if (!id || !currentUser) return;
  const { data: conversation, error: conversationError } = await db
    .from("conversations").select("status").eq("id", id).maybeSingle();
  if (conversationError) return;
  if (conversation?.status !== "resolved") return;

  const panel = $("guest-rating-panel");
  if (!panel) return;
  panel.classList.remove("hidden");

  const { data: existing, error } = await db
    .from("customer_satisfaction").select("rating,comment").eq("conversation_id", id).maybeSingle();
  if (error) {
    $("guest-rating-status").textContent = "Unable to load feedback status. Please refresh.";
    return;
  }
  if (existing) {
    setGuestRating(Number(existing.rating));
    $("guest-rating-comment").value = existing.comment || "";
    $("guest-rating-comment").disabled = true;
    $("submit-guest-rating").disabled = true;
    $("guest-rating-status").textContent = "Thank you. Your feedback has been recorded.";
    document.querySelectorAll("#guest-rating-stars button").forEach(button => button.disabled = true);
  } else {
    $("guest-rating-status").textContent = "Your feedback helps us improve.";
  }
}

function watchGuestConversation(id) {
  if (guestConversationChannel) db.removeChannel(guestConversationChannel);
  guestConversationChannel = db.channel("guest-conversation-" + id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations", filter: "id=eq." + id }, payload => {
      if (payload.new.status === "resolved") refreshGuestRatingState(id);
    }).subscribe();
}

document.querySelectorAll("#guest-rating-stars [data-rating]").forEach(button => {
  button.addEventListener("click", () => setGuestRating(Number(button.dataset.rating)));
});

if ($("submit-guest-rating")) {
  $("submit-guest-rating").addEventListener("click", async () => {
    if (!conversationId || !currentUser || !selectedGuestRating) return;
    const submit = $("submit-guest-rating");
    setBusy(submit, true, "Submitting…");
    try {
      const comment = $("guest-rating-comment").value.trim();
      const { error } = await db.from("customer_satisfaction").insert({
        conversation_id: conversationId,
        guest_user_id: currentUser.id,
        rating: selectedGuestRating,
        comment: comment || null
      });
      if (error) throw error;
      $("guest-rating-comment").disabled = true;
      document.querySelectorAll("#guest-rating-stars button").forEach(button => button.disabled = true);
      $("guest-rating-status").textContent = "Thank you. Your feedback has been recorded.";
    } catch (error) {
      $("guest-rating-status").textContent = error.code === "23505" ? "A rating has already been submitted for this conversation." : "Feedback not submitted: " + error.message;
    } finally {
      setBusy(submit, false);
      if ($( "guest-rating-status").textContent.includes("recorded") || $("guest-rating-comment").disabled) submit.disabled = true;
      else submit.disabled = !selectedGuestRating;
    }
  });
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
        await loadAttachments(conversationId, $("guest-attachments"));
        watchAttachments(conversationId, $("guest-attachments"));
        watchGuestConversation(conversationId);
        await refreshGuestRatingState(conversationId);

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

        await Promise.all([loadInbox(), loadAnalytics()]);

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
// ADMIN ANALYTICS
// All figures are returned by an admin-only RPC.
// ============================================
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "Not enough data";
  const value = Math.max(0, Math.round(Number(seconds)));
  if (value < 60) return value + " sec";
  if (value < 3600) return Math.floor(value / 60) + " min";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours + " hr" + (minutes ? " " + minutes + " min" : "");
}

function renderAnalytics(data) {
  const cards = $("analytics-cards");
  if (!cards) return;
  const items = [
    ["All conversations", data.total_conversations],
    ["Queued", data.queued_conversations],
    ["Open", data.open_conversations],
    ["Pending", data.pending_conversations],
    ["Resolved", data.resolved_conversations],
    ["New today", data.new_today],
    ["Customer messages", data.customer_messages],
    ["Human replies", data.admin_replies]
  ];
  cards.innerHTML = "";
  items.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "analytics-card";
    const number = document.createElement("strong");
    number.textContent = Number(value || 0).toLocaleString();
    const caption = document.createElement("span");
    caption.textContent = label;
    card.append(number, caption);
    cards.append(card);
  });

  const response = $("analytics-response-time");
  if (response) response.textContent = formatDuration(data.avg_first_response_seconds);

  const chart = $("analytics-chart");
  if (chart) {
    chart.innerHTML = "";
    const days = Array.isArray(data.daily_conversations) ? data.daily_conversations : [];
    const max = Math.max(1, ...days.map(item => Number(item.count || 0)));
    days.forEach(item => {
      const column = document.createElement("div");
      column.className = "analytics-day";
      const bar = document.createElement("div");
      bar.className = "analytics-bar";
      bar.style.height = Math.max(4, (Number(item.count || 0) / max) * 100) + "%";
      bar.title = Number(item.count || 0) + " conversations";
      const count = document.createElement("span");
      count.textContent = Number(item.count || 0);
      const day = document.createElement("small");
      const date = new Date(item.day + "T12:00:00");
      day.textContent = date.toLocaleDateString([], { weekday: "short" });
      column.append(count, bar, day);
      chart.append(column);
    });
  }
}

async function loadAnalytics() {
  const status = $("analytics-status");
  if (status) status.textContent = "Refreshing dashboard statistics…";
  const { data, error } = await db.rpc("admin_get_analytics");
  if (error) {
    if (status) status.textContent = "Analytics unavailable: " + error.message;
    return;
  }
  renderAnalytics(data || {});
  if (status) status.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  await loadCsatAnalytics();
}

function renderCsatAnalytics(data) {
  if ($("csat-average")) $("csat-average").textContent = data.average_rating == null ? "—" : Number(data.average_rating).toFixed(2) + " / 5";
  if ($("csat-total")) $("csat-total").textContent = Number(data.total_ratings || 0).toLocaleString();
  const distribution = $("csat-distribution");
  if (distribution) {
    distribution.innerHTML = "";
    for (let score = 5; score >= 1; score--) {
      const line = document.createElement("div"); line.className = "csat-dist-row";
      const label = document.createElement("span"); label.textContent = score + " ★";
      const track = document.createElement("div"); track.className = "csat-track";
      const fill = document.createElement("div"); fill.className = "csat-fill";
      const count = Number(data[(["","one_star","two_star","three_star","four_star","five_star"])[score]] || 0);
      const total = Math.max(1, Number(data.total_ratings || 0));
      fill.style.width = (count / total * 100) + "%"; track.append(fill);
      const value = document.createElement("small"); value.textContent = count;
      line.append(label, track, value); distribution.append(line);
    }
  }
  const feedback = $("csat-feedback");
  if (feedback) {
    feedback.innerHTML = "";
    const rows = Array.isArray(data.recent_feedback) ? data.recent_feedback : [];
    if (!rows.length) { const empty = document.createElement("p"); empty.className = "muted small"; empty.textContent = "No written feedback yet."; feedback.append(empty); }
    rows.forEach(item => {
      const card = document.createElement("article"); card.className = "csat-comment";
      const head = document.createElement("strong"); head.textContent = "★".repeat(Number(item.rating)) + "☆".repeat(5 - Number(item.rating));
      const body = document.createElement("p"); body.textContent = item.comment || "";
      const date = document.createElement("small"); date.textContent = new Date(item.created_at).toLocaleString();
      card.append(head, body, date); feedback.append(card);
    });
  }
}

async function loadCsatAnalytics() {
  const status = $("csat-status");
  if (status) status.textContent = "Loading customer feedback…";
  const { data, error } = await db.rpc("admin_get_csat_analytics");
  if (error) { if (status) status.textContent = "Feedback unavailable: " + error.message; return; }
  renderCsatAnalytics(data || {});
  if (status) status.textContent = "Feedback updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

if ($("refresh-csat")) $("refresh-csat").addEventListener("click", loadCsatAnalytics);

if ($("refresh-analytics")) {
  $("refresh-analytics").addEventListener("click", loadAnalytics);
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

  await loadAttachments(conversation.id, $("admin-attachments"));
  watchAttachments(conversation.id, $("admin-attachments"));

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
      if (attachmentChannel) {
        await db.removeChannel(attachmentChannel);
        attachmentChannel = null;
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
