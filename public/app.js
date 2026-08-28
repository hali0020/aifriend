import { emotionState, learnEmotionState } from "/emotion-engine.js";
import { createDesktopPet } from "/desktop-pet.js";
import { acceptsGameWindowSurface, historyForGameRequest, isGameSessionRequest, shouldSkipAutomaticFrame } from "/game-session-policy.js";
const $ = s => document.querySelector(s);
const electronHostPage = new URLSearchParams(window.location.search).get("electronHost") === "1";
const messages = $("#messages"), input = $("#input"), attachment = $("#attachment");
let image = null, audio = null, recorder = null, chunks = [], chatController = null, activeRequestOrigin = "", activeRequestGame = false;
let desktopPet = null;
let disposePetVisibility = null;
const historyKey = "christina-history-v3";
const ttsKey = "christina-tts-v2";
const gameKey = "christina-game-v1";
const storage={get:key=>{try{return localStorage.getItem(key)}catch{return null}},set:(key,value)=>{try{localStorage.setItem(key,value)}catch{}},remove:key=>{try{localStorage.removeItem(key)}catch{}}};
let voices = [], tts = (()=>{try{return{enabled:false,voice:"",rate:.95,...JSON.parse(storage.get(ttsKey)||"{}")}}catch{return{enabled:false,voice:"",rate:.95}}})();
let gameStream=null,gameTimer=null,gamePaused=false,gameLastAnalysis=0,gameLastSignature=null,gameSkippedFrames=0;
let gameSessionId=0,gameCaptureBusy=0,gameStarting=false,gameStopping=false,gameModelReady=false,gameStopPromise=Promise.resolve();
let gamePrefs=(()=>{try{return{gameName:"",goal:"",mode:"companion",spoilerFree:true,automatic:false,interval:60,...JSON.parse(storage.get(gameKey)||"{}")}}catch{return{gameName:"",goal:"",mode:"companion",spoilerFree:true,automatic:false,interval:60}}})();
const safetyActions=new Set(["allow","warn","support","block"]),safetySeverities=new Set(["none","low","medium","high","critical"]);
function compactSafety(verdict){
  if(!verdict||!safetyActions.has(verdict.action)||verdict.action==="allow")return null;
  const categories=Array.isArray(verdict.categories)?[...new Set(verdict.categories.filter(x=>typeof x==="string"&&/^[a-z0-9_/-]{1,64}$/i.test(x)))].slice(0,8):[];
  const source=["local","local+image","local+openai"].includes(verdict.source)?verdict.source:"local";return{phase:verdict.phase==="output"?"output":"input",action:verdict.action,severity:safetySeverities.has(verdict.severity)?verdict.severity:"medium",categories,source,remoteUsed:verdict.remoteUsed===true};
}
function restoreHistoryItem(item){
  if(!item||!["user","assistant"].includes(item.role)||typeof item.text!=="string")return null;
  const safety=compactSafety(item.safety);return{role:item.role,text:item.text.slice(0,20000),...(safety?{safety}:{})};
}
// v2 与更早的记录有可能包含安全检查上线前的原文；保留旧键，但不再自动导入、显示或发送。
let history = []; try { const saved=JSON.parse(storage.get(historyKey)||"[]"); history=Array.isArray(saved)?saved.map(restoreHistoryItem).filter(Boolean).slice(-30):[] } catch { storage.remove(historyKey) }

function escapeHtml(s=""){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function time(){return new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit"}).format(new Date())}
function formatDuration(value){const ms=Number(value);return Number.isFinite(ms)&&ms>=0?`${Math.round(ms/100)/10} 秒`:"—"}
function saveHistory(role,text,safetyVerdict=null){
  const safety=compactSafety(safetyVerdict);let safeText=String(text||"");
  if(role==="user"&&["support","block"].includes(safety?.action))return false;
  if(safety?.action==="warn"){
    const replacement=typeof safetyVerdict?.replacementText==="string"?safetyVerdict.replacementText.trim():"";
    safeText=replacement|| (role==="user"?"[敏感输入未保存]":"[敏感输出未保存]");
  }
  history.push({role,text:safeText.slice(0,20000),...(safety?{safety}:{})});history=history.slice(-30);storage.set(historyKey,JSON.stringify(history));return true;
}
function renderMsg(role,text,media,save=true,animate=false,emotionHint="",speakReply=false){
  $(".welcome")?.remove(); const el=document.createElement("div"); el.className=`msg ${role}`;
  const avatar=role==="assistant"?'<img class="msg-avatar" src="/christina-avatar.webp" alt="克里斯提娜头像">':"";
  const state=role==="assistant"?`<div class="message-state${animate?" active":""}"><i></i><span>${animate?"结论整理完了":"连接正常"}</span><small>${animate?"听好，我只说一遍":"有事就把条件说清楚"}</small></div>`:"";
  el.innerHTML=`${avatar}<div class="msg-body">${state}<div class="bubble">${media?`<img src="${media}" alt="用户上传的图片">`:""}<span class="bubble-text">${animate?"":escapeHtml(text)}</span></div><div class="meta">${role==="user"?"你":"克里斯提娜"} · ${time()} ${role==="assistant"?'<button class="copy-msg" title="复制回复">复制</button>':""}</div></div>`;
  el.querySelector(".copy-msg")?.addEventListener("click",async e=>{await navigator.clipboard.writeText(el.querySelector(".bubble-text")?.textContent||text);e.currentTarget.textContent="已复制";setTimeout(()=>e.currentTarget.textContent="复制",1200)});
  messages.append(el); messages.scrollTop=messages.scrollHeight;
  if(save)saveHistory(role,text);
  if(animate&&role==="assistant")speakText(el,text,emotionHint,speakReply);
  return el;
}
function applySafetyNotice(el,verdict){
  if(!el||!verdict||verdict.action==="allow")return;
  const existing=el.querySelector(`.safety-notice[data-phase="${verdict.phase}"]`);if(existing)existing.remove();
  const notice=document.createElement("div");notice.className=`safety-notice ${verdict.action}`;notice.dataset.phase=verdict.phase||"input";notice.setAttribute("role",verdict.action==="warn"?"status":"alert");
  const labels={warn:"敏感内容提醒",support:"先保证现实安全",block:"内容已拦截"},defaults={warn:"正文已使用安全替代文本处理。",support:"系统已停止这次请求并提供安全支持。",block:"系统已停止或替换不安全内容。"};notice.innerHTML=`<b>${labels[verdict.action]||"安全检查"}</b><span>${escapeHtml(verdict.message||defaults[verdict.action]||"系统已应用安全边界。")}</span>`;
  el.querySelector(".msg-body")?.prepend(notice);
}
history.forEach(x=>{const el=renderMsg(x.role,x.text,null,false);applySafetyNotice(el,x.safety)});
function refreshStatus(){fetch("/api/status").then(r=>r.json()).then(s=>{
  $("#status").textContent=s.processing==="local"?`本地 · ${s.model}`:s.processing==="cloud"?`云端 · ${s.model}`:s.processing==="demo"?"演示模式 · 可直接体验":s.processing==="cloud-offline"?"云端模式 · 凭据未配置":"仅本地 · Ollama 未就绪";
  const safety=$("#safetyStatus"),privacy=$("#privacyState");
  const imageGate=s.imageSemantic?.ready?"本地图像语义门已就绪":"本地图像语义门未就绪";
  if(s.safety?.remoteEnabled){safety.textContent=s.safety.remoteReady?`本地文本输入/输出检查 · ${imageGate} · 可选 OpenAI 远程复核已启用`:`本地文本输入/输出检查 · ${imageGate} · 可选远程复核配置不完整`;safety.dataset.mode=s.safety.remoteReady&&s.imageSemantic?.ready?"remote":"error"}
  else{safety.textContent=`本地文本输入/输出检查 · ${imageGate} · 可选远程复核未启用`;safety.dataset.mode=s.imageSemantic?.ready?"local":"error"}
  privacy.textContent=s.processing==="cloud"?"☁️ 云端模式 · 对话会发送给所选云服务":s.processing==="cloud-offline"?"☁️ 云端模式未配置 · 当前不会发送内容":"🔒 本地优先 · 不会自动回退云端";
}).catch(()=>{$("#status").textContent="本地服务未连接";$("#safetyStatus").textContent="安全状态暂时无法确认";$("#safetyStatus").dataset.mode="error"})}
refreshStatus();

const modelDialog=$("#modelDialog"), modelList=$("#modelList");
$("#models").onclick=()=>{modelDialog.showModal();loadModels()};
$("#closeModels").onclick=()=>modelDialog.close();
async function loadModels(){
  const [data,speech,style]=await Promise.all([fetch("/api/models").then(r=>r.json()),fetch("/api/speech/status").then(r=>r.json()),fetch("/api/style/status").then(r=>r.json())]);
  $("#provider").value=data.selected.provider||"auto";
  $("#ollamaState").textContent=data.ready?`Ollama ${data.version} · ${data.installed.length} 个模型已安装`:"Ollama 尚未就绪，安装完成后会自动连接";
  modelList.innerHTML=data.catalog.map(m=>{const selected=data.selected.model===m.id||data.selected.visionModel===m.id;return `<div class="model-item"><div class="model-info"><b>${m.name}</b><span>${m.kind} · ${m.size} · 建议 ${m.fit}</span><div class="model-progress hidden"><i></i></div></div><button data-id="${m.id}" data-action="${m.installed?"select":"pull"}" class="${selected?"primary":""}" ${!data.ready?"disabled":""}>${selected?"使用中":m.installed?"切换":"下载"}</button></div>`}).join("");
  modelList.querySelectorAll("button").forEach(b=>b.onclick=()=>b.dataset.action==="select"?selectModel(b.dataset.id):pullModel(b));
  $("#asrState").textContent=speech.ready
    ? "已安装 · 录音时按需加载"
    : String(speech.reason||"本地语音识别未就绪").slice(0,120);
  $("#styleState").textContent=`${style.source} · ${style.examples} 条短句参考`;
}
$("#provider").onchange=async e=>{const r=await fetch("/api/provider",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:e.target.value})});const data=await r.json();if(!r.ok){alert(data.error);await loadModels();return}refreshStatus()};
async function selectModel(model){const r=await fetch("/api/models/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model})});if(r.ok){await loadModels();refreshStatus()}}
async function pullModel(button){
  button.disabled=true;button.textContent="准备中";const progress=button.parentElement.querySelector(".model-progress"),bar=progress.querySelector("i");progress.classList.remove("hidden");
  try{const r=await fetch("/api/models/pull",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:button.dataset.id})});if(!r.ok)throw new Error("下载启动失败");const reader=r.body.getReader(),decoder=new TextDecoder();let pending="";while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});const lines=pending.split("\n");pending=lines.pop();for(const line of lines){if(!line.trim())continue;const p=JSON.parse(line);if(p.total){const n=Math.round((p.completed||0)/p.total*100);bar.style.width=n+"%";button.textContent=n+"%"}else if(p.status)button.textContent=p.status==="success"?"完成":p.status}}await loadModels()}catch{button.textContent="重试";button.disabled=false}
}

let stateTimer=null,activeState=null;
function setAiState(label="正在分析",detail="先核对事实和假设"){
  desktopPet?.setStatus(label,detail);if(!activeState)return;activeState.classList.add("active");activeState.querySelector("span").textContent=label;activeState.querySelector("small").textContent=detail;
}
function startThinking(el){
  clearInterval(stateTimer);activeState=el.querySelector(".message-state");const steps=[["正在分析","先核对事实和假设"],["重新检查推理","这个条件有点可疑"],["组织结论","别催，马上就好"]];let n=0;setAiState(...steps[0]);
  stateTimer=setInterval(()=>{n=Math.min(n+1,steps.length-1);setAiState(...steps[n])},1800);
}
function moodFor(text,hint=""){const mood=emotionState(text,hint);return[mood.label,mood.detail]}
function speakText(el,text,emotionHint="",speakReply=false){
  const target=el.querySelector(".bubble-text"),avatar=el.querySelector(".msg-avatar"),localState=el.querySelector(".message-state"),stateText=localState?.querySelector("span"),stateDetail=localState?.querySelector("small");avatar?.classList.add("speaking");if(localState){localState.classList.add("active");stateText.textContent="结论整理完了";stateDetail.textContent="听好，我只说一遍"}let i=0;
  const tick=()=>{i=Math.min(text.length,i+(/[，。！？；]/.test(text[i]||"")?1:2));target.textContent=text.slice(0,i);messages.scrollTop=messages.scrollHeight;if(i<text.length)setTimeout(tick,28);else{avatar?.classList.remove("speaking");const mood=moodFor(text,emotionHint);if(localState){stateText.textContent=mood[0];stateDetail.textContent=mood[1];localState.classList.remove("active")}}};tick();if(speakReply)speakAloud(text,true);
}

function saveTts(){storage.set(ttsKey,JSON.stringify(tts))}
function preferredVoice(){return voices.find(v=>v.name===tts.voice)||voices.find(v=>/^zh/i.test(v.lang)&&/Xiaoxiao|Xiaoyi|Huihui|Yaoyao|Female|女/i.test(v.name))||voices.find(v=>/^zh/i.test(v.lang))||voices[0]}
let speechGeneration=0;
function stopSpeaking(){speechGeneration++;window.speechSynthesis?.cancel();desktopPet?.setSpeaking(false)}
function speakAloud(text,force=false){if(!("speechSynthesis" in window)||(!tts.enabled&&!force))return;const generation=++speechGeneration;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text),voice=preferredVoice();if(voice){u.voice=voice;u.lang=voice.lang}u.rate=Number(tts.rate)||.95;u.pitch=1.05;u.onstart=()=>{if(generation===speechGeneration)desktopPet?.setSpeaking(true)};const finish=()=>{if(generation===speechGeneration)desktopPet?.setSpeaking(false)};u.onend=finish;u.onerror=finish;window.speechSynthesis.speak(u)}
function loadVoices(){if(!("speechSynthesis" in window)){$("#ttsState").textContent="当前浏览器不支持";$("#ttsEnabled").disabled=true;return}voices=window.speechSynthesis.getVoices();const select=$("#ttsVoice");select.innerHTML=voices.map(v=>`<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} · ${escapeHtml(v.lang)}</option>`).join("");const chosen=preferredVoice();if(chosen){tts.voice=chosen.name;select.value=chosen.name;$("#ttsState").textContent=`已就绪 · ${chosen.lang}`}else $("#ttsState").textContent="等待系统加载声音…";saveTts()}
$("#ttsEnabled").checked=tts.enabled;$("#ttsRate").value=tts.rate;$("#ttsEnabled").onchange=e=>{tts.enabled=e.target.checked;if(!tts.enabled)stopSpeaking();saveTts()};$("#ttsVoice").onchange=e=>{tts.voice=e.target.value;saveTts()};$("#ttsRate").oninput=e=>{tts.rate=Number(e.target.value);saveTts()};$("#ttsPreview").onclick=()=>speakAloud("我是克里斯提娜，也就是牧濑红莉西。先说清楚，你找我有什么事？",true);if("speechSynthesis" in window){window.speechSynthesis.onvoiceschanged=loadVoices;loadVoices()}
function syncVoiceMode(){$("#ttsEnabled").checked=tts.enabled;$("#voiceMode").textContent=tts.enabled?"语音：开":"语音：关";$("#voiceMode").classList.toggle("active",tts.enabled);desktopPet?.setVoiceEnabled(tts.enabled)}
function setVoiceMode(enabled){tts.enabled=enabled===true;if(!tts.enabled)stopSpeaking();saveTts();syncVoiceMode();return tts.enabled}
function toggleVoiceMode(){return setVoiceMode(!tts.enabled)}
$("#voiceMode").onclick=toggleVoiceMode;$("#ttsEnabled").addEventListener("change",syncVoiceMode);syncVoiceMode();
desktopPet=createDesktopPet({
  role:electronHostPage?"host":"standalone",
  trigger:$("#desktopPet"),
  avatarUrl:"/christina-avatar.webp",
  initialReply:history.filter(item=>item.role==="assistant").at(-1)?.text,
  onSend:text=>{if(chatController)return false;void sendTurn({text,game:gameStream?gamePayload(false):null,origin:"pet"});return true},
  onSnapshot:()=>{if(!gameStream||chatController||gameCaptureBusy===gameSessionId)return false;void analyzeGameFrame(false);return true},
  onSetVoice:setVoiceMode,
  onToggleVoice:toggleVoiceMode,
  onOpenMain:()=>window.focus(),
  onNativeToggle:visible=>window.desktopPetNative?.togglePet?.(visible)
});desktopPet.setVoiceEnabled(tts.enabled);
disposePetVisibility=window.desktopPetNative?.onPetVisibility?.(visible=>desktopPet?.setNativeVisible(visible))||null;

const gameDialog=$("#gameDialog"),gamePreview=$("#gamePreview"),gameSessionBar=$("#gameSessionBar");
function applyGamePrefs(){
  $("#gameName").value=gamePrefs.gameName;$("#gameGoal").value=gamePrefs.goal;$("#gameStyle").value=gamePrefs.mode;$("#gameSpoilerFree").checked=gamePrefs.spoilerFree;$("#gameAuto").checked=gamePrefs.automatic;$("#gameInterval").value=String(gamePrefs.interval);$("#gameInterval").disabled=!gamePrefs.automatic;
}
function saveGamePrefs(){
  gamePrefs={gameName:$("#gameName").value.trim().slice(0,60),goal:$("#gameGoal").value.trim().slice(0,120),mode:$("#gameStyle").value,spoilerFree:$("#gameSpoilerFree").checked,automatic:$("#gameAuto").checked,interval:Number($("#gameInterval").value)||60};storage.set(gameKey,JSON.stringify(gamePrefs));
}
function gamePayload(automatic=false){saveGamePrefs();return{enabled:true,gameName:gamePrefs.gameName,goal:gamePrefs.goal,mode:gamePrefs.mode,spoilerFree:gamePrefs.spoilerFree,automatic}}
function updateGameUi(message=""){
  const active=!!gameStream,automatic=active&&gamePrefs.automatic&&!gamePaused,busy=active&&gameCaptureBusy===gameSessionId;
  desktopPet?.setGameState({active,busy});
  gameSessionBar.classList.toggle("hidden",!active);$("#gameMode").classList.toggle("active",active);$("#gameMode").setAttribute("aria-pressed",String(active));gamePreview.classList.toggle("active",active);
  $("#chooseGameWindow").disabled=gameStarting||gameStopping||!gameModelReady;$("#gameSnapshot").disabled=!active||busy;$("#gamePause").disabled=!active||!gamePrefs.automatic;$("#gamePause").textContent=gamePaused?"继续观察":"暂停观察";$("#gameAnalyzeNow").disabled=!active||busy;$("#gameStopDialog").disabled=!active;
  $("#gameState").textContent=gameStarting?"正在选择画面":gamePaused?"自动观察已暂停":busy?"正在分析当前画面":automatic?"低频观察中":active?"画面已共享":"陪玩未开始";
  const recent=gameLastAnalysis?` · 最近分析 ${new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(gameLastAnalysis)}`:"";
  $("#gameStateDetail").textContent=message||(active?`${gamePrefs.gameName||"当前游戏"} · ${gamePaused?"画面仍在共享":automatic?`每 ${gamePrefs.interval} 秒一帧`:"仅手动分析"}${recent}`:gameStopping?"正在释放本地视觉模型":"尚未选择游戏窗口");
}
async function loadGameStatus(){
  const supported=!!navigator.mediaDevices?.getDisplayMedia;let status={ready:false,model:"qwen3-vl:4b"};try{status=await fetch("/api/game/status").then(r=>r.json())}catch{}
  gameModelReady=supported&&status.ready&&status.imageSafety?.ready;$("#gameLocalState").textContent=!supported?"当前浏览器不支持屏幕共享":gameModelReady?`本地视觉模型与图像安全门已就绪 · ${status.model} · 截图不落盘`:`${status.model} 或本地图像安全门尚未就绪，请先启动 Ollama 或安装视觉模型`;updateGameUi();return{supported,status,ready:gameModelReady};
}
function clearGameTimer(){if(gameTimer){clearTimeout(gameTimer);gameTimer=null}}
function scheduleGameObservation(){
  clearGameTimer();if(!gameStream||!gamePrefs.automatic||gamePaused)return;
  gameTimer=setTimeout(async()=>{if(gameStream&&!gamePaused&&!chatController)await analyzeGameFrame(true);scheduleGameObservation()},Math.max(30,gamePrefs.interval)*1000);
}
async function startGameSession(){
  if(gameStarting)return;if(gameStopping)await gameStopPromise;if(!navigator.mediaDevices?.getDisplayMedia)return alert("当前浏览器不支持屏幕共享。");
  gameStarting=true;let candidate=null,finalMessage="",previousStream=gameStream;const selectionToken=gameSessionId;updateGameUi("正在确认本地视觉模型");
  try{
    const check=await loadGameStatus();if(!check.ready){finalMessage="本地视觉模型或图像安全门不可用";return}saveGamePrefs();$("#gameLocalState").textContent="等待你选择游戏窗口…";
    candidate=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:2,max:5},displaySurface:"window"},audio:false});
    const track=await validateGameCandidate(candidate);if(selectionToken!==gameSessionId||gameStream!==previousStream)throw gameCaptureAbort();const token=++gameSessionId;if(activeRequestGame)chatController?.abort();clearGameTimer();
    gameStream=candidate;gamePaused=false;gamePreview.srcObject=candidate;
    try{await gamePreview.play();await waitForGameVideoFrame(gamePreview)}catch(error){gameStream=previousStream;gamePreview.srcObject=previousStream;if(previousStream)await gamePreview.play().catch(()=>{});throw error}
    if(token!==gameSessionId||gameStream!==candidate||track.readyState!=="live"||track.muted)throw gameCaptureAbort();
    const stream=candidate;previousStream?.getTracks().forEach(oldTrack=>oldTrack.stop());candidate=null;gameLastAnalysis=0;gameLastSignature=null;gameSkippedFrames=0;
    track.addEventListener("ended",()=>{if(gameStream===stream)stopGameSession()},{once:true});finalMessage=`共享中 · ${track.label||"已选择游戏窗口"} · ${gamePrefs.automatic?`每 ${gamePrefs.interval} 秒观察一帧`:"自动观察关闭"}`;$("#gameLocalState").textContent="游戏窗口已共享；模型只会收到你触发的离散截图";scheduleGameObservation();
  }catch(error){candidate?.getTracks().forEach(track=>track.stop());if(gameStream===candidate){gameStream=previousStream;gamePreview.srcObject=previousStream;if(previousStream)await gamePreview.play().catch(()=>{})}if(!gameStream){gamePreview.pause();gamePreview.srcObject=null}if(!["NotAllowedError","AbortError"].includes(error.name))alert(`无法共享画面：${error.message}`);$("#gameLocalState").textContent=error.name==="NotAllowedError"?(previousStream?"已取消切换，原游戏窗口继续共享":"你取消了屏幕共享"):error.name==="AbortError"?"共享已停止":"屏幕共享启动失败";finalMessage=previousStream?"已保留原游戏窗口":"没有开始共享"}finally{gameStarting=false;updateGameUi(finalMessage)}
}
function gameCaptureAbort(){const error=new Error("共享已停止");error.name="AbortError";return error}
function waitForGameVideoFrame(video,timeoutMs=1800){
  return new Promise((resolve,reject)=>{let settled=false,fallback=null,frameHandle=null;const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);if(fallback)clearTimeout(fallback);if(frameHandle!==null&&typeof video.cancelVideoFrameCallback==="function")video.cancelVideoFrameCallback(frameHandle);error?reject(error):resolve()};const timeout=setTimeout(()=>finish(new Error("游戏窗口暂时没有产生新画面")),timeoutMs);if(typeof video.requestVideoFrameCallback==="function")frameHandle=video.requestVideoFrameCallback(()=>{frameHandle=null;finish()});else fallback=setTimeout(()=>finish(),120)});
}
async function validateGameCandidate(stream){
  const track=stream?.getVideoTracks?.()[0];if(!track||track.readyState!=="live")throw new Error("没有取得可用的视频轨道");const surface=track.getSettings?.().displaySurface;if(!acceptsGameWindowSurface(surface,electronHostPage)){const error=new Error("请选择单个游戏窗口，不要选择整个屏幕或浏览器标签页");error.name="NotSupportedError";throw error}
  const probe=document.createElement("video");probe.muted=true;probe.playsInline=true;probe.srcObject=stream;try{await probe.play();await waitForGameVideoFrame(probe);if(track.readyState!=="live"||track.muted||probe.videoWidth<2||probe.videoHeight<2)throw new Error("所选窗口尚未提供有效画面")}finally{probe.pause();probe.srcObject=null}return track;
}
function gameSignature(canvas){try{const sample=document.createElement("canvas");sample.width=32;sample.height=18;const context=sample.getContext("2d",{alpha:false,willReadFrequently:true});context.drawImage(canvas,0,0,32,18);const pixels=context.getImageData(0,0,32,18).data,result=[];for(let i=0;i<pixels.length;i+=4)result.push(Math.round((pixels[i]*3+pixels[i+1]*6+pixels[i+2])/10));return result}catch{return null}}
function gameDifference(a,b){if(!a||!b||a.length!==b.length)return Infinity;let total=0;for(let i=0;i<a.length;i++)total+=Math.abs(a[i]-b[i]);return total/a.length}
async function captureGameFrame(token=gameSessionId){
  const started=performance.now(),stream=gameStream,track=stream?.getVideoTracks?.()[0];if(!stream||!track||track.readyState!=="live"||track.muted||gamePreview.readyState<2)throw new Error("共享画面还没有准备好");
  const ensureCurrent=()=>{if(token!==gameSessionId||gameStream!==stream||track.readyState!=="live"||track.muted)throw gameCaptureAbort()};ensureCurrent();await waitForGameVideoFrame(gamePreview);ensureCurrent();const width=gamePreview.videoWidth,height=gamePreview.videoHeight;if(width<2||height<2)throw new Error("共享窗口没有有效画面尺寸");const scale=Math.min(1,1280/Math.max(width,height)),canvas=document.createElement("canvas");canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);canvas.getContext("2d",{alpha:false}).drawImage(gamePreview,0,0,canvas.width,canvas.height);const signature=gameSignature(canvas);
  const encode=quality=>new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));let blob=await encode(.76);ensureCurrent();if(blob?.size>2*1024*1024){blob=await encode(.55);ensureCurrent()}if(!blob||blob.size>2*1024*1024)throw new Error("当前画面压缩后仍超过 2MB");const dataUrl=await readData(blob);ensureCurrent();return{name:`game-frame-${Date.now()}.jpg`,dataUrl,signature,captureMs:performance.now()-started};
}
async function analyzeGameFrame(automatic=false){
  if(!gameStream)return false;if(chatController||gameCaptureBusy===gameSessionId){if(!automatic)alert("上一条回复还没有完成。");return false}const token=gameSessionId;gameCaptureBusy=token;let finalMessage="";updateGameUi();
  try{const frame=await captureGameFrame(token),difference=gameDifference(gameLastSignature,frame.signature);if(shouldSkipAutomaticFrame({automatic,difference,skippedFrames:gameSkippedFrames,lastAnalyzedAt:gameLastAnalysis,intervalSeconds:gamePrefs.interval})){gameSkippedFrames++;finalMessage=`画面变化很小，已跳过模型分析（${gameSkippedFrames}/3）`;return true}const text=automatic?"低频观察当前游戏画面；只有画面本身存在明显、紧急或高价值信息时才提醒。":"观察当前游戏画面，先告诉我现在最值得注意的一件事，再给下一步建议。",sent=await sendTurn({text,image:{name:frame.name,dataUrl:frame.dataUrl},game:gamePayload(automatic),origin:automatic?"game-auto":"game-manual"});if(token!==gameSessionId)return false;if(sent){gameLastSignature=frame.signature;gameLastAnalysis=new Date();gameSkippedFrames=0;finalMessage=`${automatic?"自动观察完成":"当前画面分析完成"} · 截帧 ${formatDuration(frame.captureMs)}`}else finalMessage=automatic?"自动观察失败；稍后会按设定间隔重试":"画面分析失败，请检查本地视觉模型";return sent}catch(error){if(error.name!=="AbortError")finalMessage=`分析失败 · ${error.message}`;return false}finally{if(gameCaptureBusy===token)gameCaptureBusy=0;if(token===gameSessionId)updateGameUi(finalMessage)}
}
function stopGameSession(release=true){
  if(gameStopping&&!gameStream)return gameStopPromise;++gameSessionId;clearGameTimer();if(activeRequestGame)chatController?.abort();gameStream?.getTracks().forEach(track=>track.stop());gameStream=null;gamePaused=false;gamePreview.pause();gamePreview.srcObject=null;gameLastAnalysis=0;gameLastSignature=null;gameSkippedFrames=0;$("#gameLocalState").textContent="共享已停止";updateGameUi("共享已停止");if(!release)return Promise.resolve();gameStopping=true;updateGameUi("正在中止分析并释放本地视觉模型");let finalMessage="共享已停止";gameStopPromise=fetch("/api/game/stop",{method:"POST"}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"释放请求失败");if(data.released){finalMessage="共享已停止 · 视觉模型显存已释放";$("#gameLocalState").textContent="视觉模型显存已释放"}else{finalMessage=`共享已停止 · ${data.reason||"显存释放未能确认"}`;$("#gameLocalState").textContent=data.pending?"分析仍在停止；稍后可再次释放模型":"共享已停止，但显存释放未能确认"}return data}).catch(error=>{finalMessage=`共享已停止 · 显存释放失败：${error.message}`;$("#gameLocalState").textContent="共享已停止，但显存释放失败";return null}).finally(()=>{gameStopping=false;updateGameUi(finalMessage)});return gameStopPromise;
}
$("#gameMode").onclick=()=>{applyGamePrefs();$("#gameMode").setAttribute("aria-expanded","true");gameDialog.showModal();loadGameStatus()};$("#closeGame").onclick=()=>gameDialog.close();gameDialog.addEventListener("close",()=>$("#gameMode").setAttribute("aria-expanded","false"));$("#chooseGameWindow").onclick=startGameSession;$("#gameAnalyzeNow").onclick=()=>analyzeGameFrame(false);$("#gameSnapshot").onclick=()=>analyzeGameFrame(false);$("#gameStop").onclick=()=>stopGameSession();$("#gameStopDialog").onclick=()=>stopGameSession();
$("#gamePause").onclick=()=>{gamePaused=!gamePaused;updateGameUi();scheduleGameObservation()};
for(const id of ["#gameName","#gameGoal","#gameStyle","#gameSpoilerFree","#gameInterval"]){$(id).addEventListener("change",()=>{saveGamePrefs();updateGameUi();scheduleGameObservation()})}
$("#gameAuto").addEventListener("change",()=>{saveGamePrefs();$("#gameInterval").disabled=!gamePrefs.automatic;gamePaused=false;updateGameUi();scheduleGameObservation()});applyGamePrefs();updateGameUi();let pageCleanupDone=false;function cleanupPage(){if(pageCleanupDone)return;pageCleanupDone=true;if(gameStream||activeRequestGame)navigator.sendBeacon?.("/api/game/stop");gameStream?.getTracks().forEach(track=>track.stop());disposePetVisibility?.();desktopPet?.dispose()}window.addEventListener("pagehide",cleanupPage,{once:true});window.addEventListener("beforeunload",cleanupPage,{once:true});

document.querySelectorAll(".suggestions button").forEach(b=>b.onclick=()=>{input.value=b.textContent;input.focus()});
input.oninput=()=>{input.style.height="auto";input.style.height=Math.min(input.scrollHeight,120)+"px"};
input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composer").requestSubmit()}};

$("#imageInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>8e6)return alert("图片请小于 8MB");image={name:file.name,dataUrl:await readData(file)};showAttachment("image")};
function readData(file){return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)})}
function showAttachment(type){attachment.classList.remove("hidden");attachment.innerHTML=type==="image"?`<img src="${image.dataUrl}"><span>${escapeHtml(image.name)} · 图片</span><button>移除</button>`:`<span>🎙️ 语音已录好 · ${audio.name}</span><button>移除</button>`;attachment.querySelector("button").onclick=()=>{image=null;audio=null;$("#imageInput").value="";attachment.classList.add("hidden")}}

$("#mic").onclick=async()=>{
  if(recorder?.state==="recording"){recorder.stop();return}
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{const blob=new Blob(chunks,{type:recorder.mimeType||"audio/webm"});audio={name:"voice.webm",dataUrl:await readData(blob)};stream.getTracks().forEach(t=>t.stop());$("#mic").classList.remove("recording");showAttachment("audio")};recorder.start();$("#mic").classList.add("recording")}catch{alert("无法使用麦克风，请检查浏览器权限。")}
};

async function sendTurn(turn={}){
  const text=String(turn.text||"").trim(),sentImage=turn.image||null,sentAudio=turn.audio||null,game=turn.game||null,origin=turn.origin||"chat",gameFrame=origin.startsWith("game"),gameRequest=isGameSessionRequest(origin,game),automatic=origin==="game-auto";
  if(chatController){if(origin==="chat"){chatController.abort();stopSpeaking()}return false}
  if(!text&&!sentImage&&!sentAudio)return false;
  const shownUserText=gameFrame?"[游戏画面] 看一下当前情况":text||(sentAudio?"[语音消息]":"[图片]");
  const userEl=!automatic?renderMsg("user",shownUserText,gameFrame?null:sentImage?.dataUrl,false):null;
  if(origin==="chat"){input.value="";input.style.height="auto";image=null;audio=null;$("#imageInput").value="";attachment.classList.add("hidden")}
  let typing=null;
  if(!automatic){typing=document.createElement("div");typing.className="msg assistant waiting";typing.innerHTML='<img class="msg-avatar thinking-avatar" src="/christina-avatar.webp" alt="克里斯提娜头像"><div class="msg-body"><div class="message-state active"><i></i><span>正在分析</span><small>先核对事实和假设</small></div><div class="bubble typing"><i></i><i></i><i></i></div></div>';messages.append(typing);messages.scrollTop=messages.scrollHeight;startThinking(typing)}
  const controller=new AbortController();chatController=controller;activeRequestOrigin=origin;activeRequestGame=gameRequest;desktopPet?.begin(gameFrame?"正在观察你共享的游戏画面":"先核对事实和假设");$("#send").textContent="■";$("#send").title="停止生成";
  let out=null,full="",inputVerdict=null,outputVerdict=null,inputSaved=false;
  const registerInputSafety=verdict=>{
    if(!verdict)return;inputVerdict=verdict;applySafetyNotice(userEl,verdict);
    if(userEl&&verdict.action==="warn")userEl.querySelector(".bubble-text").textContent=verdict.replacementText||"[敏感输入未保存]";
    if(userEl&&["support","block"].includes(verdict.action)){userEl.querySelector(".bubble-text").textContent="[原始输入已由安全检查隔离，未保存]";userEl.querySelector(".bubble img")?.remove()}
    if(!automatic&&!gameFrame&&!game?.enabled&&!inputSaved&&["allow","warn"].includes(verdict.action)){inputSaved=saveHistory("user",shownUserText,verdict)}
    const petState={warn:["谨慎回答","检测到敏感信息"],support:["先保证你安全","已停止模型生成"],block:["这部分不能帮","请求已由安全检查拦截"]}[verdict.action];if(petState)desktopPet?.setStatus(...petState);
  };
  const registerOutputSafety=verdict=>{if(!verdict)return;outputVerdict=verdict;applySafetyNotice(out,verdict)};
  const inputStopped=()=>["support","block"].includes(inputVerdict?.action);
  try{
    const payload=gameFrame?{text,image:sentImage,game}:{text,image:sentImage,audio:sentAudio,game,history:historyForGameRequest(history,game)},options={method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal};
    let r=await fetch(gameFrame?"/api/game/analyze-stream":"/api/chat-stream",options);
    if(r.status===409&&!game){
      r=await fetch("/api/chat",options);const data=await r.json();if(!r.ok)throw new Error(data.error||"请求失败");
      registerInputSafety(data.safety?.input||{phase:"input",action:"allow",message:"本地安全检查已通过"});
      typing?.remove();clearInterval(stateTimer);full=data.text;out=renderMsg("assistant",full,null,false,true,data.affect||"",tts.enabled||!!sentAudio);registerOutputSafety(data.safety?.output);
       if(!inputStopped()&&!gameFrame&&!game?.enabled)saveHistory("assistant",full,data.safety?.output);desktopPet?.complete(full,data.demo?"演示回复":"备用回复");return true;
    }
    if(!r.ok){let data={};try{data=await r.json()}catch{}throw new Error(data.error||`请求失败（${r.status}）`)}
    typing?.remove();clearInterval(stateTimer);if(!automatic)out=renderMsg("assistant","",null,false,false);const target=out?.querySelector(".bubble-text"),reader=r.body.getReader(),decoder=new TextDecoder();let pending="",meta=null;
    while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});const lines=pending.split("\n");pending=lines.pop();for(const line of lines){if(!line.trim())continue;const item=JSON.parse(line);if(item.event==="safety"){if(item.phase==="input")registerInputSafety(item);else registerOutputSafety(item)}else if(item.event==="meta"){meta=item;desktopPet?.setStatus("本地处理中",item.route||item.model);$("#status").textContent=`本地 · ${item.model} · ${item.route}`;if(item.transcript&&out)out.querySelector(".message-state small").textContent=`已识别：${item.transcript.slice(0,32)}`}else if(item.event==="delta"){full+=item.text;desktopPet?.stream(full);if(target){target.textContent=full;messages.scrollTop=messages.scrollHeight}}else if(item.event==="metrics"){$("#metrics").textContent=`模型首 token ${formatDuration(item.firstTokenMs)} · 可见回复 ${formatDuration(item.releaseMs)} · 总计 ${formatDuration(item.totalMs)} · 输出 ${item.outputTokens??"—"} tokens`}else if(item.event==="error")throw new Error(item.error)}}
    if(!full.trim())throw new Error("模型没有返回正文");
    if(automatic&&/^\s*\[无新情况\][。！!？?]?\s*$/.test(full)){desktopPet?.idle();return true}
    if(automatic)out=renderMsg("assistant",full,null,false,true,meta?.affect||"",tts.enabled);else{if(!gameFrame&&!game?.enabled&&!inputStopped())saveHistory("assistant",full,outputVerdict);out.querySelector(".message-state span").textContent=inputStopped()?inputVerdict.action==="support"?"先保证你安全":"请求已拦截":outputVerdict?.action==="block"?"已替换不安全输出":"回复完成";out.querySelector(".message-state small").textContent=outputVerdict?.action==="warn"?"已应用敏感内容边界":meta?.route||"本地模型";if(tts.enabled||sentAudio)speakAloud(full,true)}
    desktopPet?.complete(full,meta?.route||"本地模型");return true;
  }catch(err){typing?.remove();clearInterval(stateTimer);desktopPet?.fail(err.message,err.name==="AbortError");const safetyPending=!inputVerdict&&!gameFrame;if(safetyPending){applySafetyNotice(userEl,{phase:"input",action:"warn",message:"安全检查未完成；这条输入没有保存。"});if(userEl){userEl.querySelector(".bubble-text").textContent="[安全检查未完成，原始输入未保存]";userEl.querySelector(".bubble img")?.remove()}}if(err.name==="AbortError"){if(out&&full)out.querySelector(".message-state small").textContent="已中断";else out?.remove()}else{if(out&&!full)out.remove();if(automatic)updateGameUi(`自动观察失败 · ${err.message}`);else renderMsg("assistant",safetyPending?`安全检查尚未完成，已停止请求且未保存输入：${err.message}`:`刚才连接没有成功：${err.message}`,null,false,true)}return false}finally{if(chatController===controller){chatController=null;activeRequestOrigin="";activeRequestGame=false;$("#send").textContent="↑";$("#send").title="发送";if(origin==="chat")input.focus()}}
}
$("#composer").onsubmit=async e=>{
  e.preventDefault();if(chatController){chatController.abort();stopSpeaking();return}const text=input.value.trim();if(!text&&!image&&!audio)return;
  await sendTurn({text,image,audio,game:gameStream?gamePayload(false):null,origin:"chat"});
};
$("#export")?.addEventListener("click",()=>{const lines=["# 与克里斯提娜的对话","",...history.flatMap(x=>[`## ${x.role==="user"?"我":"克里斯提娜"}`,"",x.text,""])];const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`克里斯提娜-对话-${new Date().toISOString().slice(0,10)}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
const memoryDialog=$("#memoryDialog");async function loadMemory(){const data=await fetch("/api/memory").then(r=>r.json());$("#memoryList").innerHTML=data.items.length?data.items.map(x=>`<div class="memory-item"><small>${{preference:"偏好",event:"事件",boundary:"边界"}[x.type]||"记忆"}</small><span>${escapeHtml(x.text)}</span><button data-id="${x.id}">删除</button></div>`).join(""):'<div class="memory-item"><span>还没有保存任何长期记忆。</span></div>';$("#memoryList").querySelectorAll("button").forEach(b=>b.onclick=async()=>{await fetch("/api/memory",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:b.dataset.id})});loadMemory()})}
$("#memory").onclick=()=>{memoryDialog.showModal();loadMemory()};$("#closeMemory").onclick=()=>memoryDialog.close();$("#memoryForm").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/memory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:$("#memoryType").value,text:$("#memoryText").value})}),data=await r.json();if(!r.ok){alert(data.error||"这条记忆没有保存");return}$("#memoryText").value="";if(data.safety?.action==="warn")alert("检测到敏感字段，已脱敏后保存。");loadMemory()};$("#clearMemory").onclick=async()=>{if(confirm("删除全部长期记忆吗？")){await fetch("/api/memory",{method:"DELETE",headers:{"Content-Type":"application/json"},body:"{}"});loadMemory()}};$("#clearCache").onclick=async()=>{await fetch("/api/cache/clear",{method:"POST"});$("#clearCache").textContent="已释放"};
$("#clear").onclick=()=>{if(!confirm("清空当前对话并重新开始吗？"))return;if(gameStream||activeRequestGame)stopGameSession();chatController?.abort();chatController=null;activeRequestGame=false;stopSpeaking();history=[];image=null;audio=null;input.value="";input.style.height="auto";attachment.classList.add("hidden");document.querySelector(".waiting")?.remove();clearInterval(stateTimer);storage.remove(historyKey);desktopPet?.complete("好了，现在重新说明你的问题。尽量把条件说完整。","记录已清空");messages.innerHTML='<div class="welcome"><div class="orb avatar"><img src="/christina-avatar.webp" alt="克里斯提娜头像"></div><h2>记录已清空</h2><p>好了，现在重新说明你的问题。<br>尽量把条件说完整。</p></div>'};
