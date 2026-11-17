const SUPABASE_URL = "https://keknignerubsxxtzvrog.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8WKlYGyXbxb33SoWmtMXtw_9bC8pxVW";
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);
const show = (id) => { ["welcome","chat","staff-login","inbox"].forEach(x => $(x).classList.toggle("hidden", x !== id)); };
let conversationId = null, currentUser = null, selectedConversation = null, messageChannel = null, listChannel = null;

const FAQ = [
  {keys:["hour","open","available","time"], answer:"Our automated support is available anytime. A human CSR will reply when an agent is online. Human response times depend on agent availability."},
  {keys:["bill","payment","refund","charge"], answer:"For billing help, tell us the date and a short description of the transaction. Never send your full card number, password, or one-time code."},
  {keys:["account","login","password","subscriber"], answer:"For account help, describe the issue and include the email linked to your account. Never share your password or verification code."},
  {keys:["human","agent","csr","person","representative"], answer:"I'll notify the support queue so an available customer service representative can assist you."}
];
function faqAnswer(text) { const t=text.toLowerCase(); const hit=FAQ.find(x=>x.keys.some(k=>t.includes(k))); return hit?.answer || "Thanks for your message. I've added it to the conversation. A support representative will respond when available."; }
function addBubble(container, body, mine=false, bot=false, time=new Date()) {
  const el=document.createElement("div"); el.className="bubble"+(mine?" mine":"")+(bot?" bot":"");
  const text=document.createElement("div"); text.textContent=body; el.append(text);
  const meta=document.createElement("small"); meta.textContent=(bot?"Automated assistant":mine?"You":"Support team")+" · "+new Date(time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); el.append(meta);
  container.append(el); container.scrollTop=container.scrollHeight;
}
function demoNotice(){ $("setup-note").textContent="Preview mode: connect Supabase to enable persistent live conversations."; }

async function ensureGuest() {
  const { data: { session }, error } = await db.auth.getSession();
  if (error) throw error;

  // Do not reuse an administrator or staff session as a guest.
  if (session && session.user.is_anonymous !== true) {
    await db.auth.signOut();
  }

  const { data, error: signInError } =
    await db.auth.signInAnonymously();

  if (signInError) throw signInError;
  if (!data.user || data.user.is_anonymous !== true) {
    throw new Error("Could not establish an anonymous guest session.");
  }

  return data.user;
}

async function loadMessages(id, target=$("messages"), guest=true) {
  target.innerHTML="";
  const {data,error}=await db.from("messages").select("id,body,sender_role,created_at").eq("conversation_id",id).eq("visibility","public").order("created_at",{ascending:true}).limit(100);
  if(error) throw error;
  data.forEach(m=>addBubble(target,m.body,m.sender_role==="customer" && guest,m.sender_role==="bot",m.created_at));
  if(messageChannel) await db.removeChannel(messageChannel);
  messageChannel=db.channel("messages-"+id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq."+id},payload=>{
    const m=payload.new; if(m.visibility==="public") addBubble(target,m.body,m.sender_role==="customer" && guest,m.sender_role==="bot",m.created_at);
  }).subscribe();
}
$("guest-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!configured){show("chat");$("messages").innerHTML="";addBubble($("messages"),"Welcome! This is a preview. Connect Supabase to start a real conversation.",false,true);return;}
  try{
    currentUser=await ensureGuest();
    const name=$("guest-name").value.trim(), email=$("guest-email").value.trim(), topic=$("guest-topic").value;
    const {error:profileError}=await db.from("guest_profiles").upsert({user_id:currentUser.id,full_name:name,email,topic},{onConflict:"user_id"});
    if(profileError) throw profileError;
    const {data:conv,error}=await db.rpc("create_guest_conversation",{p_subject:topic});
    if(error) throw error;
    conversationId=conv; sessionStorage.setItem("supportdesk_conversation",conversationId);
    show("chat"); await loadMessages(conversationId);
    $("chat-subtitle").textContent="Conversation started for "+name;
    addBubble($("messages"),"Hello "+name+"! Welcome to support. You can ask a question or choose a quick topic below.",false,true);
  }catch(err){alert("Unable to start chat: "+err.message);}
});

$("message-form").addEventListener("submit", async e => {
  e.preventDefault();

  const input = $("message-input");
  const body = input.value.trim();

  if (!body || !conversationId || !currentUser) return;

  const button = $("message-form")
    .querySelector('button[type="submit"]');

  setBusy(button, true, "Sending...");

  try {
    const { error } = await db.from("messages").insert({
      conversation_id: conversationId,
      sender_id: currentUser.id,
      body,
      sender_role: "customer",
      visibility: "public"
    });

    if (error) throw error;

    input.value = "";
  } catch (error) {
    alert("Message not sent: " + error.message);
  } finally {
    setBusy(button, false);
  }
});

  if(error){alert("Message not sent: "+error.message);return;}
  $("message-input").value="";
  // FAQ answer is advisory UI automation. Human handoff and durable bot replies should be handled by a trusted Edge Function.
  const answer=faqAnswer(body);
  const {data:faqs}=await db.from("faq_entries").select("question,answer,keywords").eq("active",true).limit(50);
  const matched=faqs?.find(f=>(f.keywords||[]).some(k=>body.toLowerCase().includes(String(k).toLowerCase())));
  addBubble($("messages"),matched?.answer||answer,false,true);
});
document.querySelectorAll("[data-faq]").forEach(b=>b.addEventListener("click",()=>{const map={hours:"What are your support hours?",billing:"I need help with billing or payment.",account:"I need help with my account."};$("message-input").value=map[b.dataset.faq];$("message-input").focus();}));
$("staff-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured){$("staff-error").textContent="Connect Supabase first.";return;}
  const {data,error}=await db.auth.signInWithPassword({email:$("staff-email").value,password:$("staff-password").value});
  if(error){$("staff-error").textContent=error.message;return;}
  const {data:profile,error:pErr}=await db.from("staff_profiles").select("display_name,role,active").eq("user_id",data.user.id).single();
  if (pErr || !profile?.active || profile.role !== "admin") {
  await db.auth.signOut();
  $("staff-error").textContent = "Only the active administrator can log in.";
  return;
}
async function loadInbox() {
  const { data: conversations, error } = await db
    .from("conversations")
    .select("id,guest_user_id,subject,status,created_at,updated_at")
    .in("status", ["queued", "open", "pending"])
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    $("conversation-list").textContent = error.message;
    return;
  }

  const guestIds = [...new Set(
    conversations.map(c => c.guest_user_id).filter(Boolean)
  )];

  let guests = [];

  if (guestIds.length) {
    const result = await db
      .from("guest_profiles")
      .select("user_id,full_name,email")
      .in("user_id", guestIds);

    if (result.error) {
      $("conversation-list").textContent = result.error.message;
      return;
    }

    guests = result.data || [];
  }

  const guestMap = new Map(
    guests.map(g => [g.user_id, g])
  );

  $("conversation-list").innerHTML = "";

  conversations.forEach(c => {
    const guest = guestMap.get(c.guest_user_id) || {};

    const item = document.createElement("button");
    item.className = "conversation-item";

    const title = document.createElement("b");
    title.textContent = guest.full_name || "Guest";

    const sub = document.createElement("small");
    sub.textContent = (c.subject || "Support") + " · " + c.status;

    item.append(title, sub);

    item.addEventListener("click", () => {
      openAgentConversation({ ...c, guest_profiles: guest });
    });

    $("conversation-list").append(item);
  });

  if (!conversations.length) {
    $("conversation-list").textContent = "No active conversations.";
  }

  if (listChannel) await db.removeChannel(listChannel);

  listChannel = db.channel("conversation-list")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "conversations"
    }, () => loadInbox())
    .subscribe();
}

async function openAgentConversation(c){
  selectedConversation=c;$("agent-thread-title").textContent=(c.guest_profiles?.full_name||"Guest")+" · "+(c.guest_profiles?.email||"");
  $("resolve-chat").disabled=false;$("take-chat").disabled=false;
  const {data,error}=await db.from("messages").select("id,body,sender_role,visibility,created_at").eq("conversation_id",c.id).order("created_at").limit(100);
  if(error){alert(error.message);return;}
  $("agent-messages").innerHTML="";
  data.filter(m=>m.visibility==="public"||m.visibility==="internal").forEach(m=>addBubble($("agent-messages"),(m.visibility==="internal"?"[INTERNAL NOTE] ":"")+m.body,m.sender_role!=="customer",m.sender_role==="bot",m.created_at));
  if(messageChannel)await db.removeChannel(messageChannel);
  messageChannel=db.channel("agent-"+c.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq."+c.id},p=>addBubble($("agent-messages"),p.new.body,p.new.sender_role!=="customer",p.new.sender_role==="bot",p.new.created_at)).subscribe();
}

$("agent-message-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!selectedConversation || !currentUser) return;

  const input = $("agent-message-input");
  const body = input.value.trim();

  if (!body) return;

  const button = $("agent-message-form")
    .querySelector('button[type="submit"]');

  setBusy(button, true, "Sending...");

  try {
    const { error } = await db.from("messages").insert({
      conversation_id: selectedConversation.id,
      sender_id: currentUser.id,
      body,
      sender_role: "admin",
      visibility: "public"
    });

    if (error) throw error;

    input.value = "";
  } catch (error) {
    alert("Reply not sent: " + error.message);
  } finally {
    setBusy(button, false);
  }
});

  if(error){alert(error.message);return;}$("agent-message-input").value="";
});
$("take-chat").addEventListener("click",async()=>{
  if(!selectedConversation)return;
  const {error}=await db.rpc("assign_conversation_to_self",{p_conversation_id:selectedConversation.id});
  if(error)alert(error.message);else{alert("Conversation assigned to you.");await loadInbox();}
});
$("resolve-chat").addEventListener("click",async()=>{
  if(!selectedConversation)return;
  const {error}=await db.from("conversations").update({status:"resolved"}).eq("id",selectedConversation.id);
  if(error)alert(error.message);else{selectedConversation=null;$("agent-thread-title").textContent="Conversation resolved";$("agent-messages").innerHTML="";await loadInbox();}
});
$("signout").addEventListener("click",async()=>{await db.auth.signOut();show("staff-login");});
const path=location.pathname;
if(path==="/agent"||path==="/agent/")show("staff-login");else show("welcome");
if(!configured)demoNotice();
