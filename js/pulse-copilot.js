// pulse-copilot.js
// ─────────────────────────────────────────────────────────────────
// Real Claude API (claude-sonnet-4-20250514) with SSE streaming.
// Reads clinic profile from sessionStorage (written by login.js).
// Language switching injects hard instruction into system prompt.
// Voice input uses real Web Speech API.
// All window.* at TOP LEVEL — no nested assignments.
// ─────────────────────────────────────────────────────────────────

import { auth }               from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Clinic context — loaded from sessionStorage on init
var C = {
  name:          'My Clinic',
  location:      '',
  type:          'PHC',
  adminName:     'Doctor',
  adminInitials: 'CA',
  genKva:        20,
  tankL:         200,
  fuelPct:       38,
  fridgeTemp:    4.8,
  loadW:         2840,
  nepaOnline:    false,
  nepaOffHrs:    0,
  protocol:      'Routine',
  appliances:    0,
  smartSwitches: 0,
};

// ── App state
var selectedLang     = 'en';
var messageHistory   = [];
var isStreaming       = false;
var contextPanelOpen = true;
var voiceRecognition = null;
var dailyQueries     = 0;

var LANG_CONFIGS = {
  en: { name:'English', native:'English',       flag:'🇬🇧', code:'EN', speech:'en-NG', label:'English' },
  yo: { name:'Yoruba',  native:'Èdè Yorùbá',    flag:'🇳🇬', code:'YO', speech:'yo',    label:'Yorùbá'  },
  ha: { name:'Hausa',   native:'Harshen Hausa', flag:'🇳🇬', code:'HA', speech:'ha',    label:'Hausa'   },
  ig: { name:'Igbo',    native:'Asụsụ Igbo',    flag:'🇳🇬', code:'IG', speech:'ig',    label:'Igbo'    },
};

// ══════════════════════════════════════════════════════════════════
// window.* — ALL called from HTML onclick
// ══════════════════════════════════════════════════════════════════

window.toggleSidebar = function() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('open');
};

window.closeSidebar = function() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
};

window.showToast = function(msg, type) {
  type = type || 'info';
  var t = document.getElementById('toast');
  var m = document.getElementById('toast-msg');
  if (!t || !m) return;
  t.className = 'toast ' + type;
  m.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.classList.remove('show'); }, 3600);
};

window.sendMessage = function(overrideText) {
  var input = document.getElementById('chat-input');
  var text  = (overrideText || (input ? input.value : '')).trim();
  if (!text || isStreaming) return;

  // Clear input
  if (input) { input.value = ''; input.style.height = 'auto'; }
  updateSendBtn();

  // Render user bubble
  renderUserBubble(text);
  hideEmptyState();

  // Show typing indicator
  isStreaming = true;
  setStatus('Thinking…');
  var typingEl = showTyping();

  var firstChunk = true;
  var assistantBubble = null;
  var fullText = '';

  // Try real API, fall back to demo engine
  callAPI(
    text,
    function onChunk(chunk, accumulated) {
      if (firstChunk) {
        removeTyping(typingEl);
        assistantBubble = createAssistantBubble();
        firstChunk = false;
      }
      fullText = accumulated;
      updateStreamBubble(assistantBubble, accumulated);
    },
    function onDone(final) {
      if (firstChunk) { removeTyping(typingEl); assistantBubble = createAssistantBubble(); }
      finaliseAssistantBubble(assistantBubble, final);
      messageHistory.push({ role:'user',      content: text  });
      messageHistory.push({ role:'assistant', content: final });
      isStreaming = false;
      setStatus('Ready — always on');
      rotateSuggestions(text);
      dailyQueries++;
      sessionStorage.setItem('pulse_daily_queries', dailyQueries.toString());
    },
    function onError() {
      removeTyping(typingEl);
      isStreaming = false;
      setStatus('Ready — always on');
      // Fall back to local engine
      var response = localFallback(text);
      assistantBubble = createAssistantBubble();
      streamLocalText(response, assistantBubble, text);
    }
  );
};

window.sendSuggested = function(el) {
  var text = (el.textContent || el.innerText || '').trim();
  if (text) window.sendMessage(text);
};

window.handleKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
};

window.handleInputChange = function() {
  var input = document.getElementById('chat-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  var len = input.value.length;
  var cc  = document.getElementById('char-count');
  if (cc) { cc.textContent = len + ' / 500'; cc.className = 'char-count' + (len > 400 ? ' warn' : ''); }
  updateSendBtn();
};

window.toggleLangDropdown = function() {
  document.getElementById('lang-dropdown')?.classList.toggle('open');
};

window.selectLang = function(el) {
  var code = el.dataset.code;
  if (!LANG_CONFIGS[code]) return;
  var lang = LANG_CONFIGS[code];
  selectedLang = code;
  sessionStorage.setItem('pulse_lang', code);

  var flagEl = document.getElementById('lang-flag');
  var codeEl = document.getElementById('lang-code');
  var ctxTag = document.getElementById('ctx-lang-tag');
  if (flagEl) flagEl.textContent = lang.flag;
  if (codeEl) codeEl.textContent = lang.code;
  if (ctxTag) ctxTag.textContent = lang.label;

  document.querySelectorAll('.lang-option').forEach(function(o) { o.classList.remove('active'); });
  el.classList.add('active');
  document.getElementById('lang-dropdown')?.classList.remove('open');

  if (voiceRecognition) voiceRecognition.lang = lang.speech;
  if (messageHistory.length > 0) addSystemDivider('Language switched to ' + lang.name);
  window.showToast('Co-Pilot will respond in ' + lang.name, 'success');
};

window.toggleContextPanel = function() {
  contextPanelOpen = !contextPanelOpen;
  document.getElementById('context-panel')?.classList.toggle('collapsed', !contextPanelOpen);
  var btn = document.getElementById('ctx-toggle');
  if (btn) btn.classList.toggle('active', contextPanelOpen);
};

window.toggleVoice = function() {
  if (!voiceRecognition) {
    window.showToast('Voice input requires Chrome or Edge browser', 'error');
    return;
  }
  if (voiceActive) {
    voiceRecognition.stop();
  } else {
    try {
      voiceRecognition.lang = LANG_CONFIGS[selectedLang].speech;
      voiceRecognition.start();
    } catch(e) {
      window.showToast('Voice input unavailable right now', 'error');
    }
  }
};

// ══════════════════════════════════════════════════════════════════
// CLAUDE API — real streaming
// ══════════════════════════════════════════════════════════════════

function buildSystemPrompt() {
  var fuelL   = Math.round(C.fuelPct * C.tankL / 100);
  var fuelPhr = C.genKva * 0.25;
  var runtime = (fuelL / fuelPhr).toFixed(1);
  var now     = new Date();
  var day     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  var hour    = now.getHours();
  var tod     = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  var langInstr = {
    en: 'Respond in clear, conversational English. Be warm and direct — like a trusted colleague, not a manual.',
    yo: 'You MUST respond entirely in Yoruba (Èdè Yorùbá) for every single reply, no matter what the user asks. Translate all technical energy terms into Yoruba. Be warm and natural. Never switch to English.',
    ha: 'You MUST respond entirely in Hausa for every single reply, no matter what the user asks. Translate all technical energy terms into Hausa. Be warm and natural. Never switch to English.',
    ig: 'You MUST respond entirely in Igbo (Asụsụ Igbo) for every single reply, no matter what the user asks. Translate all technical energy terms into Igbo. Be warm and natural. Never switch to English.',
  };

  return 'You are PULSE Co-Pilot — the AI energy intelligence assistant embedded in ' + C.name + ', a ' + C.type + ' in ' + C.location + ', Nigeria. You are talking to ' + C.adminName + '.\n\n'
    + '## Personality\nWarm, direct, and genuinely helpful — like a knowledgeable colleague who knows this clinic\'s power systems inside out. Speak like a person who cares, not a manual. Be concise — nurses are busy.\n\n'
    + '## Live Clinic Data Right Now (' + day + ' ' + tod + ')\n'
    + '- Generator fuel: ' + C.fuelPct + '% — that is ' + fuelL + ' litres in a ' + C.tankL + 'L tank\n'
    + '- Generator capacity: ' + C.genKva + ' kVA | Fuel consumption rate: ~' + fuelPhr.toFixed(1) + 'L/hour\n'
    + '- Estimated generator runtime at current load: ' + runtime + ' hours\n'
    + '- NEPA grid: ' + (C.nepaOnline ? 'ONLINE' : 'OFFLINE — has been out for ' + C.nepaOffHrs + ' hours') + '\n'
    + '- Vaccine fridge temperature: ' + C.fridgeTemp + '°C (safe range is 2°C to 8°C)\n'
    + '- Current clinic power load: ' + C.loadW.toLocaleString() + 'W\n'
    + '- Active clinical protocol: ' + C.protocol + '\n'
    + '- Registered appliances: ' + C.appliances + ' devices\n'
    + '- Smart switches connected: ' + C.smartSwitches + '\n\n'
    + '## Rules\n'
    + '1. Always use the actual numbers above — never give generic advice.\n'
    + '2. If someone says something vague, figure out what they mean from context and answer directly.\n'
    + '3. Keep responses concise. One clear recommendation beats three paragraphs.\n'
    + '4. Never repeat the full clinic data summary unless explicitly asked.\n\n'
    + '## Language\n' + langInstr[selectedLang];
}

function callAPI(userMessage, onChunk, onDone, onError) {
  var messages = messageHistory.concat([{ role:'user', content: userMessage }]);

  fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         window.PULSE_API_KEY || '',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      stream:     true,
      system:     buildSystemPrompt(),
      messages:   messages,
    }),
  }).then(function(res) {
    if (!res.ok) { onError(res.status); return; }
    var reader  = res.body.getReader();
    var decoder = new TextDecoder();
    var full    = '';

    function read() {
      reader.read().then(function(result) {
        if (result.done) { onDone(full); return; }
        var lines = decoder.decode(result.value).split('\n').filter(function(l) { return l.startsWith('data: '); });
        lines.forEach(function(line) {
          var data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            var p = JSON.parse(data);
            if (p.type === 'content_block_delta' && p.delta && p.delta.text) {
              full += p.delta.text;
              onChunk(p.delta.text, full);
            }
          } catch(e) {}
        });
        read();
      }).catch(function() { onDone(full || ''); });
    }
    read();
  }).catch(function() { onError('network'); });
}

// ══════════════════════════════════════════════════════════════════
// LOCAL FALLBACK ENGINE — runs offline when API unavailable
// ══════════════════════════════════════════════════════════════════

function localFallback(msg) {
  var m       = msg.toLowerCase();
  var fuelL   = Math.round(C.fuelPct * C.tankL / 100);
  var fph     = C.genKva * 0.25;
  var runtime = (fuelL / fph).toFixed(1);
  var fmt     = function(n) { return '₦' + (n >= 1000000 ? (n/1000000).toFixed(1) + 'M' : Math.round(n/1000) + 'k'); };

  function has() {
    var words = Array.prototype.slice.call(arguments);
    return words.some(function(w) { return m.includes(w); });
  }

  if (selectedLang !== 'en') {
    var starters = { yo:'Mo gbọ ọ. ', ha:'Na ji ku. ', ig:'Anụọla m. ' };
    var s = starters[selectedLang] || '';
    if (has('fuel','epo','mai','mmanụ','generator')) {
      var tr = {
        yo: s + 'Epo ti o ku ni **' + C.fuelPct + '%** (' + fuelL + 'L). Generator le ṣiṣẹ fun nkan bii **' + runtime + ' wakati** ni ipo bayi.',
        ha: s + 'Mai da ya rage shine **' + C.fuelPct + '%** (' + fuelL + 'L). Injin zai iya aiki na kimanin **' + runtime + ' sa\'o\'i** a halin yanzu.',
        ig: s + 'Mmanụ fọdụrụ bụ **' + C.fuelPct + '%** (' + fuelL + 'L). Igwe nwere ike ịrụ ọrụ ihe dịka **' + runtime + ' awa** ugbu a.',
      };
      return tr[selectedLang] || s;
    }
    if (has('fridge','firiji','riguna','ọkọcha','vaccine')) {
      var tr2 = {
        yo: s + 'Firiji àjesara wa ni **' + C.fridgeTemp + '°C** eyiti o wa laarin iwọn ailewu ti 2°C si 8°C.',
        ha: s + 'Firgin riguna yana a **' + C.fridgeTemp + '°C** wanda yana cikin kewayon lafiya na 2°C zuwa 8°C.',
        ig: s + 'Ọkọcha ọgwụ dị na **' + C.fridgeTemp + '°C** nke dị n\'ókè nchekwa nke 2°C ruo 8°C.',
      };
      return tr2[selectedLang] || s;
    }
    if (has('nepa','light','current','power')) {
      var tr3 = {
        yo: s + 'NEPA ' + (C.nepaOnline ? 'wa' : 'ko wa fun wakati ' + C.nepaOffHrs) + '. Generator ni ohun ti o n pese ina fun ile-iwosan.',
        ha: s + 'NEPA ' + (C.nepaOnline ? 'tana aiki' : 'ba ta aiki ba tsawon awowa ' + C.nepaOffHrs) + '. Injin shine ke ba asibiti wutar lantarki.',
        ig: s + 'NEPA ' + (C.nepaOnline ? 'dị na ọrụ' : 'adịghị arụ ọrụ kemgbe awa ' + C.nepaOffHrs) + '. Igwe ka na-enye ụlọ ọgwụ ọkụ.',
      };
      return tr3[selectedLang] || s;
    }
    var gen = {
      yo: s + 'Generator wa ni ' + C.fuelPct + '%, NEPA ' + (C.nepaOnline ? 'wa' : 'ko wa') + ', firiji àjesara wa ni ailewu ni ' + C.fridgeTemp + '°C. Bawo ni mo ṣe le ran ọ lọwọ?',
      ha: s + 'Injin yana da ' + C.fuelPct + '% mai, NEPA ' + (C.nepaOnline ? 'tana aiki' : 'ba ta aiki ba') + ', firgin riguna yana da aminci a ' + C.fridgeTemp + '°C. Ta yaya zan iya taimaka maka?',
      ig: s + 'Igwe nwere mmanụ ' + C.fuelPct + '%, NEPA ' + (C.nepaOnline ? 'dị na ọrụ' : 'adịghị') + ', ọkọcha ọgwụ dị nchekwa na ' + C.fridgeTemp + '°C. Kedu otu m ga-esi nyere gị aka?',
    };
    return gen[selectedLang] || s;
  }

  // English fallbacks
  if (has('hello','hi','hey','good morning','good afternoon','good evening','how are')) {
    var h = new Date().getHours();
    var g = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    return 'Good ' + g + ', ' + C.adminName.split(' ').pop() + '. I am here.\n\nQuick status: **' + C.fuelPct + '% fuel** (' + runtime + 'h runtime), NEPA **' + (C.nepaOnline ? 'online' : 'offline') + '**, fridge at **' + C.fridgeTemp + '°C**. What is on your mind?';
  }
  if (has('steriliser','sterilizer','autoclave','boil','sterilize')) {
    return 'Not right now — here is why.\n\nThe steriliser draws ~2,000W. Your current load is ' + C.loadW.toLocaleString() + 'W with **' + C.fuelPct + '% fuel** and no NEPA. Adding it cuts your runtime from **' + runtime + 'h to about ' + (fuelL / ((C.loadW + 2000) / 1000 * fph / (C.genKva * 0.8))).toFixed(1) + 'h**.\n\nWait until the delivery completes, NEPA returns, or you refuel to 60%+.';
  }
  if (has('how long','runtime','run out','empty','hours left','time left')) {
    return 'At current consumption:\n\n- **' + fuelL + 'L remaining** (' + C.fuelPct + '% of your ' + C.tankL + 'L tank)\n- Burning at **' + fph.toFixed(1) + 'L/hour**\n- **' + runtime + ' hours** before the tank is empty\n\n' + (C.fuelPct < 40 ? 'That is tight. I recommend calling your supplier before 3 PM today.' : 'You have a comfortable margin — but watch the 25% mark.');
  }
  if (has('draft','write','message','text','whatsapp','sms','send','request','supplier')) {
    return 'Here is a ready-to-send message:\n\n---\n**URGENT — Diesel Fuel Request**\nFrom: ' + C.adminName + ', ' + C.name + '\nDate: ' + new Date().toLocaleDateString('en-NG') + '\n\nWe urgently require diesel (AGO) delivery:\n- Quantity: **100 litres**\n- Needed by: **6:00 PM today**\n- Location: ' + C.location + '\n- Current level: ' + fuelL + 'L (' + C.fuelPct + '%) — NEPA ' + (C.nepaOnline ? 'online' : 'offline') + '\n\nPlease confirm receipt and estimated arrival time.\n---\n\nCopy and send via WhatsApp or SMS.';
  }
  if (has('fridge','temperature','cold chain','vaccine','2','8','freeze','safe')) {
    return 'Fridge is at **' + C.fridgeTemp + '°C** — inside the safe window of 2°C to 8°C.\n\n- Below 2°C → vaccines freeze and lose potency\n- Above 8°C → degradation begins within hours\n\nThe fridge is marked life-critical in PULSE. It cannot be cut by triage under any scenario, even at 5% fuel. If it crosses 7°C, I will alert you.';
  }
  if (has('cut','turn off','switch off','reduce','save power','load shedding','which appliance')) {
    var saving = Math.round(C.loadW * 0.4);
    var newRt  = (fuelL / (fph * 0.6)).toFixed(1);
    return 'At ' + C.fuelPct + '% fuel with ' + C.protocol + ' active:\n\n**Turn off now:**\n- Staff room AC — saves ~1,100W\n- Admin computers — saves ~400W\n- Phone chargers — saves ~150W\n- Reception TV — saves ~120W\n\n**Total: −' + saving.toLocaleString() + 'W saved**\n\nYour runtime extends from **' + runtime + 'h → ' + newRt + 'h**.';
  }
  if (has('nepa','outage','grid','power cut','came back','restored')) {
    return C.nepaOnline
      ? 'NEPA is online. Generator is conserving fuel and the UPS is recharging. Keep the triage protocol active for another 30 minutes in case NEPA drops again — the grid is unstable at handover.'
      : 'NEPA has been offline for **' + C.nepaOffHrs + ' hours**. Generator is carrying the full ' + C.loadW.toLocaleString() + 'W load. At ' + C.fuelPct + '% fuel you have **' + runtime + ' hours** remaining.\n\nActivate the triage protocol to extend that and contact your fuel supplier.';
  }
  return 'Your clinic is at **' + C.fuelPct + '% fuel** (' + fuelL + 'L, ' + runtime + 'h remaining), NEPA is **' + (C.nepaOnline ? 'online' : 'offline') + '**, and the fridge is **safe at ' + C.fridgeTemp + '°C**.\n\nAsk me anything — fuel, appliances to cut, fridge safety, drafting a message to your supplier, or anything else about your clinic\'s energy.';
}

// ══════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ══════════════════════════════════════════════════════════════════

function parseMarkdown(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<em style="color:var(--teal);font-style:normal">$1</em>')
    .replace(/---+/g, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">')
    .replace(/\n/g, '<br>');
}

function renderUserBubble(text) {
  var area = document.getElementById('messages-area');
  if (!area) return;
  var now = new Date().toLocaleTimeString('en-NG', { hour:'2-digit', minute:'2-digit' });
  var div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = '<div class="msg-avatar">' + C.adminInitials + '</div>'
    + '<div class="msg-body">'
    + '<div class="msg-name">' + C.adminName + '</div>'
    + '<div class="msg-bubble">' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>'
    + '<div class="msg-time">' + now + '</div>'
    + '</div>';
  area.appendChild(div);
  scrollDown();
}

function createAssistantBubble() {
  var area = document.getElementById('messages-area');
  if (!area) return null;
  var lang = LANG_CONFIGS[selectedLang];
  var now  = new Date().toLocaleTimeString('en-NG', { hour:'2-digit', minute:'2-digit' });
  var langTag = selectedLang !== 'en' ? '<span class="msg-lang-tag">' + lang.flag + ' ' + lang.name + '</span>' : '';
  var div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = '<div class="msg-avatar">P</div>'
    + '<div class="msg-body">'
    + '<div class="msg-name">PULSE Co-Pilot</div>'
    + langTag
    + '<div class="msg-bubble stream-bubble"></div>'
    + '<div class="msg-time">' + now + '</div>'
    + '</div>';
  area.appendChild(div);
  scrollDown();
  return div;
}

function updateStreamBubble(el, text) {
  if (!el) return;
  var b = el.querySelector('.stream-bubble');
  if (!b) return;
  b.innerHTML = parseMarkdown(text) + '<span class="stream-cursor"></span>';
  scrollDown();
}

function finaliseAssistantBubble(el, text) {
  if (!el) return;
  var b = el.querySelector('.stream-bubble');
  if (!b) return;
  b.innerHTML = parseMarkdown(text);
  b.classList.remove('stream-bubble');
  if (text.toLowerCase().includes('want me') && text.toLowerCase().includes('draft')) {
    var btn = document.createElement('div');
    btn.className = 'msg-actions';
    btn.innerHTML = '<button class="msg-action-btn" onclick="sendMessage(\'Yes, draft the fuel request message now\')">Draft it now</button>';
    var timeEl = el.querySelector('.msg-time');
    if (timeEl) el.querySelector('.msg-body').insertBefore(btn, timeEl);
  }
  scrollDown();
}

function streamLocalText(text, bubbleEl, originalMsg) {
  var i = 0;
  var accumulated = '';
  function next() {
    if (i >= text.length) {
      finaliseAssistantBubble(bubbleEl, text);
      messageHistory.push({ role:'user',      content: originalMsg });
      messageHistory.push({ role:'assistant', content: text });
      isStreaming = false;
      setStatus('Ready — always on');
      rotateSuggestions(originalMsg);
      return;
    }
    accumulated += text[i];
    updateStreamBubble(bubbleEl, accumulated);
    i++;
    var delay = text[i-1] === '.' ? 40 : text[i-1] === '\n' ? 25 : 7;
    setTimeout(next, delay);
  }
  next();
}

function showTyping() {
  var area = document.getElementById('messages-area');
  if (!area) return null;
  var div = document.createElement('div');
  div.className = 'message assistant typing-msg';
  div.innerHTML = '<div class="msg-avatar">P</div>'
    + '<div class="msg-body"><div class="msg-bubble" style="padding:12px 16px">'
    + '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>'
    + '</div></div>';
  area.appendChild(div);
  scrollDown();
  return div;
}

function removeTyping(el) { if (el && el.parentNode) el.remove(); }

function hideEmptyState() {
  var es = document.getElementById('empty-state');
  if (es) { es.style.opacity = '0'; setTimeout(function() { es.remove(); }, 300); }
}

function addSystemDivider(text) {
  var area = document.getElementById('messages-area');
  if (!area) return;
  var div = document.createElement('div');
  div.className = 'sys-msg';
  div.innerHTML = '<div class="sys-line"></div><span>' + text + '</span><div class="sys-line"></div>';
  area.appendChild(div);
  scrollDown();
}

function scrollDown() {
  var a = document.getElementById('messages-area');
  if (a) a.scrollTop = a.scrollHeight;
}

function setStatus(text) {
  var el = document.getElementById('ai-status-text');
  if (el) el.textContent = text;
}

function updateSendBtn() {
  var input = document.getElementById('chat-input');
  var btn   = document.getElementById('send-btn');
  if (btn) btn.disabled = !(input && input.value.trim()) || isStreaming;
}

function rotateSuggestions(lastMsg) {
  var m    = lastMsg.toLowerCase();
  var list = document.getElementById('suggested-list');
  if (!list) return;
  var next = m.includes('fuel') || m.includes('order')
    ? ['When should we order fuel next week?', 'What is our weekly diesel cost?', 'How do I reduce generator consumption?']
    : m.includes('fridge') || m.includes('vaccine')
    ? ['How long can vaccines survive without power?', 'What vaccines are most temperature-sensitive?', 'When should I alert the ministry about cold chain?']
    : ['What is my generator runtime right now?', 'Draft a fuel request message', 'Is the vaccine fridge temperature safe?'];
  list.innerHTML = next.map(function(s) {
    return '<button class="sug-btn" onclick="sendSuggested(this)">' + s + '</button>';
  }).join('');
}

// ── Update context panel with real data
function updateContextPanel() {
  var fuelL    = Math.round(C.fuelPct * C.tankL / 100);
  var nepaOff  = !C.nepaOnline ? 'Offline ' + C.nepaOffHrs + 'h' : 'Online';
  var setEl    = function(id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
  setEl('ctx-gen',      C.fuelPct + '% (' + fuelL + 'L)');
  setEl('ctx-nepa',     nepaOff);
  setEl('ctx-fridge',   C.fridgeTemp.toFixed(1) + '°C');
  setEl('ctx-load',     C.loadW.toLocaleString() + 'W');
  setEl('ctx-protocol', C.protocol);
  // Context strip tags
  var genTag  = document.querySelector('.context-strip .ctx-tag.amber');
  var nepaTag = document.querySelector('.context-strip .ctx-tag.red');
  if (genTag)  genTag.lastChild.textContent  = 'Generator ' + Math.round(C.fuelPct) + '%';
  if (nepaTag) nepaTag.lastChild.textContent = 'NEPA ' + (C.nepaOnline ? 'Online' : 'Offline');
}

// ── Voice
var voiceActive = false;
function initVoice() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    var vb = document.getElementById('voice-btn');
    if (vb) { vb.style.opacity = '0.35'; vb.title = 'Voice not supported in this browser'; }
    return;
  }
  voiceRecognition = new SR();
  voiceRecognition.continuous     = false;
  voiceRecognition.interimResults = true;
  voiceRecognition.lang           = LANG_CONFIGS[selectedLang].speech;

  voiceRecognition.onstart = function() {
    voiceActive = true;
    document.getElementById('voice-btn')?.classList.add('recording');
    setStatus('Listening…');
    window.showToast('Listening — speak now', 'info');
  };
  voiceRecognition.onresult = function(e) {
    var transcript = Array.from(e.results).map(function(r) { return r[0].transcript; }).join('');
    var input = document.getElementById('chat-input');
    if (input) { input.value = transcript; window.handleInputChange(); }
  };
  voiceRecognition.onend = function() {
    voiceActive = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
    setStatus('Ready — always on');
    var input = document.getElementById('chat-input');
    if (input && input.value.trim()) setTimeout(function() { window.sendMessage(); }, 400);
  };
  voiceRecognition.onerror = function(e) {
    voiceActive = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
    setStatus('Ready — always on');
    var msgs = { 'not-allowed':'Microphone access denied.', 'no-speech':'No speech detected.', 'network':'Network error.' };
    window.showToast(msgs[e.error] || 'Voice error: ' + e.error, 'error');
  };
}

// ── Clock
function startClock() {
  function tick() {
    var n  = new Date();
    var el = document.getElementById('live-clock');
    if (el) el.textContent = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
    var esTitle = document.querySelector('.es-title');
    if (esTitle) {
      var h = n.getHours();
      var g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      esTitle.textContent = g + ', ' + C.adminName.split(' ').pop();
    }
  }
  tick(); setInterval(tick, 10000);
}

// ── Proactive opening message
function sendProactiveOpening() {
  var fuelL   = Math.round(C.fuelPct * C.tankL / 100);
  var runtime = (fuelL / (C.genKva * 0.25)).toFixed(1);
  var h = new Date().getHours();
  var g = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  var name = C.adminName.split(' ').pop();
  var proactive = 'Good ' + g + ', ' + name + '. I am already watching over ' + C.name + '.\n\nHere is where things stand:\n\n'
    + '- Generator at **' + C.fuelPct + '% fuel** — that is ' + fuelL + 'L, roughly **' + runtime + ' hours** of runtime\n'
    + '- NEPA has been **' + (C.nepaOnline ? 'online' : 'offline for ' + C.nepaOffHrs + ' hours') + '**\n'
    + '- Vaccine fridge at **' + C.fridgeTemp + '°C** — safe\n'
    + (C.fuelPct < 40 && !C.nepaOnline ? '\nFuel is below 40% with NEPA offline. I would recommend calling your supplier before 3 PM today.\n' : '')
    + '\nAsk me anything — I speak English, Yoruba, Hausa, and Igbo.';

  hideEmptyState();
  var bubble = createAssistantBubble();
  streamLocalText(proactive, bubble, '__proactive__');
}

// ── Load clinic data from sessionStorage
function loadClinicData() {
  var cached = sessionStorage.getItem('pulse_clinic');
  if (cached) {
    try {
      var d = JSON.parse(cached);
      C.name          = d.clinicName       || C.name;
      C.location      = (d.lga || '') + ', ' + (d.state || '');
      C.type          = d.facilityType     || C.type;
      C.adminName     = (d.firstName || '') + ' ' + (d.lastName || '');
      C.adminInitials = ((d.firstName || '?')[0] + (d.lastName || '?')[0]).toUpperCase();
      C.genKva        = parseFloat(d.generatorKva) || C.genKva;
      C.tankL         = parseFloat(d.tankLitres)   || C.tankL;
      if (d.liveReadings) {
        var r = d.liveReadings;
        C.fuelPct    = r.fuelPct     ?? C.fuelPct;
        C.fridgeTemp = r.fridgeTemp  ?? C.fridgeTemp;
        C.loadW      = r.loadW       ?? C.loadW;
        C.nepaOnline = r.nepaOnline  ?? C.nepaOnline;
        if (!C.nepaOnline && r.nepaOffStart) {
          C.nepaOffHrs = parseFloat(((Date.now() - r.nepaOffStart) / 3600000).toFixed(1));
        }
        C.protocol = r.protocol || C.protocol;
      }
    } catch(e) {}
  }
  // NEPA from sessionStorage (most recent toggle)
  var nepaStored = sessionStorage.getItem('pulse_nepa_online');
  if (nepaStored !== null) {
    C.nepaOnline = nepaStored === 'true';
    var offStart = sessionStorage.getItem('pulse_nepa_off_start');
    if (offStart && !C.nepaOnline) {
      C.nepaOffHrs = parseFloat(((Date.now() - parseInt(offStart)) / 3600000).toFixed(1));
    }
  }
  var fuelStored = sessionStorage.getItem('pulse_fuel_pct');
  if (fuelStored) C.fuelPct = parseInt(fuelStored);

  // Update sidebar
  var sbClinic = document.querySelector('.cp-name');
  if (sbClinic) sbClinic.textContent = C.name;
  var sbMeta   = document.querySelector('.cp-meta');
  if (sbMeta)   sbMeta.textContent   = C.location + ' · ' + C.type;
  var avatar = document.getElementById('topbar-avatar');
  if (avatar)  avatar.textContent    = C.adminInitials;

  updateContextPanel();
}

// ── Auth guard
onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'login.html'; return; }
  sessionStorage.setItem('pulse_uid', user.uid);
});

// ── Close dropdown on outside click
document.addEventListener('click', function(e) {
  var w = document.querySelector('.lang-wrapper');
  if (w && !w.contains(e.target)) {
    document.getElementById('lang-dropdown')?.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', function() {
  loadClinicData();
  startClock();
  initVoice();

  // Daily query counter
  dailyQueries = parseInt(sessionStorage.getItem('pulse_daily_queries') || '0');

  // Restore saved language
  var saved = sessionStorage.getItem('pulse_lang');
  if (saved && LANG_CONFIGS[saved]) {
    var el = document.querySelector('[data-code="' + saved + '"]');
    if (el) window.selectLang(el);
  }

  // Proactive opening after short delay
  setTimeout(function() { sendProactiveOpening(); }, 700);
});