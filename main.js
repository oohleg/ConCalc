// --- КОНФИГУРАЦИЯ ---
const APP_VERSION = '21'; // <--- МЕНЯТЬ ВЕРСИЮ ТОЛЬКО ЗДЕСЬ

// --- ИНИЦИАЛИЗАЦИЯ ИНТЕРФЕЙСА ---
const editor = document.getElementById('editor');

// Устанавливаем динамический placeholder с версией
editor.placeholder = `\n\nConCalc v${APP_VERSION} - текстовый калькулятор.\nВыражение в строке вычисляется по мере ввода.\nТекст сохраняется между запусками.\nКнопка ? - математические возможности и горячие клавиши.\n`;

// --- ДИНАМИЧЕСКИЙ MANIFEST.JSON (PWA) ---
const manifestData = {
  "name": "Console Calculator",
  "short_name": "ConCalc",
  "version": APP_VERSION,
  "start_url": "index.html",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0078d7",
  "icons": [
    { "src": "icons/icon-16.png", "sizes": "16x16", "type": "image/png" },
    { "src": "icons/icon-32.png", "sizes": "32x32", "type": "image/png" },
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
};
const manifestBlob = new Blob([JSON.stringify(manifestData)], {type: 'application/json'});
const manifestURL = URL.createObjectURL(manifestBlob);
const link = document.createElement('link');
link.rel = 'manifest';
link.href = manifestURL;
document.head.appendChild(link);

// --- РЕГИСТРАЦИЯ SERVICE WORKER ---
if ('serviceWorker' in navigator) {
  // Передаем версию в URL, чтобы SW обновил кеш
  navigator.serviceWorker.register(`service-worker.js?v=${APP_VERSION}`)
    .then(() => console.log(`Service Worker v${APP_VERSION} registered`))
    .catch(err => console.log('SW registration skipped (file:// protocol)'));
}

// --- КОД MATH WORKER (BLOB) ---
// Используем ту же версию 11.8.0 внутри воркера
const WORKER_CODE = `
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.8.0/math.min.js');
  math.config({ number: 'BigNumber', precision: 64 });

  self.onmessage = function(e) {
    const { id, text } = e.data;
    const lines = text.split('\\n');
    const results = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let resultStr = null;
      if (line.trim() !== '') {
        let parts = line.split(' = ');
        let expr = parts[0];
        if (expr.trim() !== '') {
          try {
            const cleanExpr = expr.replace(/,/g, '.').replace(/\\s/g, '');
            let result = math.evaluate(cleanExpr);
            let out = math.format(result, { notation: 'fixed', precision: 10 }).replace(/\\.?0+$/, '');
            resultStr = expr + ' = ' + out; 
          } catch (error) { resultStr = expr; }
        }
      }
      if (resultStr === null) resultStr = line.split(' = ')[0]; 
      results.push(resultStr);
    }
    self.postMessage({ id: id, results: results });
  };
`;

// --- ПЕРЕМЕННЫЕ СОСТОЯНИЯ ---
const MAX_HISTORY_SIZE = 300;
let historyStack = [];
let historyIndex = -1;
let isUndoingRedoing = false; 
let saveTimeout = null; 

let worker = null;
let currentRequestId = 0;
let workerTimeout = null;
const CALCULATION_TIMEOUT = 1000; 

// --- МЕНЕДЖЕР ИСТОРИИ ---
function saveHistory(text, caret, force = false) {
  if (isUndoingRedoing) return;
  if (!force && historyStack.length > 0 && historyIndex >= 0) {
    if (historyStack[historyIndex].text === text) return;
  }
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  historyStack.push({ text: text, caret: caret });
  historyIndex++;
  if (historyStack.length > MAX_HISTORY_SIZE) {
    historyStack.shift();
    historyIndex--;
  }
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    restoreState();
  }
}

function redo() {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    restoreState();
  }
}

function restoreState() {
  const state = historyStack[historyIndex];
  if (!state) return;
  isUndoingRedoing = true;
  editor.value = state.text;
  editor.selectionStart = editor.selectionEnd = state.caret;
  localStorage.setItem('editorText', state.text);
  scrollCaretIntoView();
  triggerCalculation(); 
  isUndoingRedoing = false;
}

// --- ИНИЦИАЛИЗАЦИЯ ---
const savedText = localStorage.getItem('editorText') || "";
editor.value = savedText;
saveHistory(editor.value, editor.selectionStart, true);
initWorker();

// --- УПРАВЛЕНИЕ ВОРКЕРОМ ---
function initWorker() {
  if (worker) worker.terminate();
  const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  worker = new Worker(workerUrl);
  
  worker.onmessage = function(e) {
    const { id, results } = e.data;
    if (id !== currentRequestId) return;
    if (workerTimeout) { clearTimeout(workerTimeout); workerTimeout = null; }
    applyWorkerResults(results);
  };
  worker.onerror = (err) => console.error("Worker Error:", err);
}

function triggerCalculation() {
  if (isUndoingRedoing) return;
  currentRequestId++;
  const thisRequestId = currentRequestId;
  if (workerTimeout) clearTimeout(workerTimeout);
  
  workerTimeout = setTimeout(() => {
    console.warn("Calculation timeout. Restarting Worker.");
    initWorker(); 
  }, CALCULATION_TIMEOUT);

  worker.postMessage({ id: thisRequestId, text: editor.value });
}

function applyWorkerResults(newLines) {
  const originalText = editor.value;
  const originalLines = originalText.split('\n');
  if (originalLines.length !== newLines.length) return;

  let hasChanges = false;
  let resultLines = [];

  for (let i = 0; i < originalLines.length; i++) {
    const originalLine = originalLines[i];
    const newLine = newLines[i];
    const originalExpr = originalLine.split(' = ')[0];
    const newExpr = newLine.split(' = ')[0];

    // Применяем результат только если выражение слева не изменилось
    if (originalExpr === newExpr && originalLine !== newLine) {
        hasChanges = true;
        resultLines.push(newLine);
    } else {
      resultLines.push(originalLine);
    }
  }

  if (hasChanges) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = resultLines.join('\n');
    editor.selectionStart = start;
    editor.selectionEnd = end;
    scrollCaretIntoView();
  }
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ UI ---
function scrollCaretIntoView() {
  const style = getComputedStyle(editor);
  const lineHeight = parseFloat(style.lineHeight);
  const text = editor.value;
  const caretPos = editor.selectionStart;
  const lines = text.split('\n');
  const caretLine = text.slice(0, caretPos).split('\n').length - 1;
  const caretY = caretLine * lineHeight;
  const viewTop = editor.scrollTop;
  const viewBottom = viewTop + editor.clientHeight;

  if (caretY < viewTop) editor.scrollTop = caretY;
  else if (caretY + lineHeight > viewBottom) {
    if (caretLine === lines.length - 1) editor.scrollTop = editor.scrollHeight;
    else editor.scrollTop = caretY + lineHeight - editor.clientHeight;
  }
}

function showCopyTooltip() {
  const tooltip = document.createElement('div');
  tooltip.textContent = "Скопировано";
  tooltip.style.cssText = `
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    background-color: rgba(0, 0, 0, 0.6); color: #fff; padding: 10px 20px;
    border-radius: 4px; z-index: 1000; pointer-events: none;
  `;
  document.body.appendChild(tooltip);
  setTimeout(() => tooltip.remove(), 500);
}

// Helper для операций со строками (удаление, дублирование)
function handleLineOp(operation) {
    saveHistory(editor.value, editor.selectionStart, true);
    const lines = editor.value.split('\n');
    const caretPos = editor.selectionStart;
    let cum = 0, idx = 0;
    for(let i=0; i<lines.length; i++) {
        if(cum + lines[i].length >= caretPos) { idx = i; break; }
        cum += lines[i].length + 1;
    }
    
    operation(lines, idx);
    
    editor.value = lines.join('\n');
    // Восстановление позиции курсора
    let newPos = 0;
    const targetIdx = Math.min(idx, lines.length);
    for(let i=0; i<targetIdx; i++) newPos += lines[i].length + 1;
    if (lines.length > targetIdx) newPos += lines[targetIdx].length;

    editor.selectionStart = editor.selectionEnd = newPos;
    
    triggerCalculation();
    saveHistory(editor.value, editor.selectionStart, true);
    localStorage.setItem('editorText', editor.value);
}

// --- ОБРАБОТЧИКИ СОБЫТИЙ ---
editor.addEventListener('keydown', (event) => {
  // Undo/Redo
  if (event.ctrlKey && event.code === 'KeyZ' && !event.shiftKey) { event.preventDefault(); undo(); return; }
  if ((event.ctrlKey && event.code === 'KeyY') || (event.ctrlKey && event.shiftKey && event.code === 'KeyZ')) { event.preventDefault(); redo(); return; }
  
  // Save/Help/Copy
  if (event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); saveToFile(); return; }
  if (event.ctrlKey && event.code === 'KeyH') { event.preventDefault(); helpBtn.click(); return; }
  if (event.ctrlKey && event.code === 'KeyC') {
    if (editor.selectionStart === editor.selectionEnd) { event.preventDefault(); copyLineResult(); }
    return;
  }
  
  // Clear (Ctrl+X)
  if (event.ctrlKey && event.code === 'KeyX') { 
    if (editor.selectionStart === editor.selectionEnd) {
      event.preventDefault();
      saveHistory(editor.value, editor.selectionStart, true);
      editor.value = "";
      editor.dispatchEvent(new Event('input'));
      editor.focus();
      saveHistory(editor.value, 0, true);
    }
    return;
  }
  
  // Duplicate (Ctrl+D)
  if (event.ctrlKey && event.code === 'KeyD') { 
    event.preventDefault();
    handleLineOp((lines, idx) => {
        lines.splice(idx + 1, 0, lines[idx]);
    });
    return;
  }

  // Delete Line (Ctrl+K)
  if (event.ctrlKey && event.code === 'KeyK') { 
    event.preventDefault();
    handleLineOp((lines, idx) => {
        lines.splice(idx, 1);
    });
    return;
  }

  // Insert Line (Ctrl+Enter)
  if (event.ctrlKey && (event.key === 'Enter' || event.keyCode === 13)) { 
    event.preventDefault();
    handleLineOp((lines, idx) => {
        lines.splice(idx, 0, "");
    });
    return;
  }

  // Normal Enter
  if (!event.ctrlKey && (event.key === 'Enter' || event.keyCode === 13)) { 
    event.preventDefault();
    saveHistory(editor.value, editor.selectionStart);
    const text = editor.value;
    const nextNewline = text.indexOf('\n', editor.selectionStart);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    editor.value = text.slice(0, lineEnd) + "\n" + text.slice(lineEnd);
    editor.selectionStart = editor.selectionEnd = lineEnd + 1;
    scrollCaretIntoView();
    saveHistory(editor.value, editor.selectionStart, true);
    localStorage.setItem('editorText', editor.value);
    return;
  }
});

editor.addEventListener('input', () => {
  if (isUndoingRedoing) return;
  localStorage.setItem('editorText', editor.value);
  triggerCalculation();
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveHistory(editor.value, editor.selectionStart), 500);
});

editor.addEventListener('paste', (event) => {
  event.preventDefault();
  saveHistory(editor.value, editor.selectionStart, true);
  const pasted = (event.clipboardData || window.clipboardData).getData('text/plain').replace(/(\r\n|\n|\r)/gm, '');
  const start = editor.selectionStart;
  editor.value = editor.value.slice(0, start) + pasted + editor.value.slice(editor.selectionEnd);
  editor.selectionStart = editor.selectionEnd = start + pasted.length;
  triggerCalculation();
  saveHistory(editor.value, editor.selectionStart, true);
  localStorage.setItem('editorText', editor.value);
});

function saveToFile() {
  if (window.showSaveFilePicker) {
    (async () => {
      try {
        const h = await window.showSaveFilePicker({types:[{description:'Text', accept:{'text/plain':['.txt']}}]});
        const w = await h.createWritable(); await w.write(editor.value); await w.close();
      } catch(e){}
    })();
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([editor.value], {type:'text/plain'}));
    a.download = prompt("Имя файла", "doc.txt") || "doc.txt";
    a.click();
  }
}

function copyLineResult() {
  const lines = editor.value.split('\n');
  let cum=0, idx=0;
  for(let i=0; i<lines.length; i++) {
     if(cum + lines[i].length >= editor.selectionStart) { idx=i; break; }
     cum += lines[i].length + 1;
  }
  const parts = lines[idx].split(' = ');
  if(parts[1]) {
      navigator.clipboard.writeText(parts[1].trim()).then(showCopyTooltip);
  }
}

// Кнопки интерфейса
document.getElementById('clear-btn').onclick = () => {
    saveHistory(editor.value, editor.selectionStart, true);
    editor.value = "";
    editor.dispatchEvent(new Event('input'));
    saveHistory("", 0, true);
};

const helpBtn = document.getElementById('help-btn');
helpBtn.onclick = () => {
  saveHistory(editor.value, editor.selectionStart, true);
  if (editor.value && !editor.value.endsWith('\n')) editor.value += '\n\n';
  
  // Вставляем текст помощи с версией
  editor.value += `ConCalc v${APP_VERSION}

Математические возможности:
https://mathjs.org/docs/expressions/syntax.html

Горячие клавиши:
- Ctrl+C копирует результат строки.
- Ctrl+X или кнопка C очищают всё.
- Ctrl+K удаляет строку.
- Ctrl+D дублирует строку.
- Ctrl+Enter вставляет строку перед текущей.
- Ctrl+S сохраняет всё в файл.
- Ctrl+Z/Y: Отмена/Повтор
- Ctrl+H выводит помощь.
`;
  
  editor.selectionStart = editor.selectionEnd = editor.value.length;
  triggerCalculation();
  saveHistory(editor.value, editor.selectionStart, true);
  editor.focus();
};

const updateTheme = () => document.getElementById('editor').classList.toggle('dark-theme', window.matchMedia('(prefers-color-scheme: dark)').matches);
updateTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
editor.focus();