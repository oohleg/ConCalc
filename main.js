// Регистрируем Service Worker для поддержки офлайн-режима и кеширования
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('Service Worker зарегистрирован'))
    .catch(err => console.error('Ошибка регистрации Service Worker:', err));
}

// Вставляем настройку точных вычислений
math.config({
  number: 'BigNumber',
  precision: 64
});

const editor = document.getElementById('editor');

// Восстанавливаем сохранённый текст из localStorage (если есть)
editor.value = localStorage.getItem('editorText') || "";

// Флаги для отличия программных обновлений от пользовательских изменений и для восстановления состояния
let isUpdating = false;
let restoring = false;
// Флаг для пропуска автообновления при нажатии Enter или Ctrl+Enter
let skipCalculation = false;
// Стек для хранения состояний редактора (текст + положение каретки) для отмены (Ctrl+Z)
let undoStack = [];

// Автопрокрутка при выходе за пределы textarea
function scrollCaretIntoView() {
  const style      = getComputedStyle(editor);
  const lineHeight = parseFloat(style.lineHeight);
  const text       = editor.value;
  const caretPos   = editor.selectionStart;
  const lines      = text.split('\n');
  const caretLine  = text.slice(0, caretPos).split('\n').length - 1;
  const caretY     = caretLine * lineHeight;

  const viewTop    = editor.scrollTop;
  const viewBottom = viewTop + editor.clientHeight;

  if (caretY < viewTop) {
    // Строка ушла вверх — доскролливаем так, чтобы она была сверху
    editor.scrollTop = caretY;
  } 
  else if (caretY + lineHeight > viewBottom) {
    // Строка ушла вниз
    if (caretLine === lines.length - 1) {
      // Если это последняя (только что добавленная) строка — сразу в самый низ
      editor.scrollTop = editor.scrollHeight;
    } else {
      // Иначе — подвинем так, чтобы она оказалась внизу видимой области
      editor.scrollTop = caretY + lineHeight - editor.clientHeight;
    }
  }
}

// Функция для показа tooltip в центре экрана на 500 мс (при копировании)
function showCopyTooltip() {
  const tooltip = document.createElement('div');
  tooltip.textContent = "Скопировано";
  tooltip.style.position = "fixed";
  tooltip.style.left = "50%";
  tooltip.style.top = "50%";
  tooltip.style.transform = "translate(-50%, -50%)";
  tooltip.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
  tooltip.style.color = "#fff";
  tooltip.style.padding = "10px 20px";
  tooltip.style.borderRadius = "4px";
  tooltip.style.zIndex = "1000";
  tooltip.style.pointerEvents = "none";
  document.body.appendChild(tooltip);
  setTimeout(() => {
    tooltip.remove();
  }, 500);
}

// Единый обработчик keydown для Ctrl+Z, Ctrl+S, Ctrl+C, Ctrl+X, Ctrl+K, Ctrl+D, Ctrl+Enter, Ctrl+H и Enter
editor.addEventListener('keydown', (event) => {
  // Обработка отмены (Ctrl+Z)
  if (event.ctrlKey && event.code === 'KeyZ') {
    event.preventDefault();
    if (undoStack.length > 1) {
      // Удаляем текущее состояние и восстанавливаем предыдущее
      undoStack.pop();
      const prevState = undoStack[undoStack.length - 1];
      isUpdating = true;
      restoring = true;
      editor.value = prevState.text;
      editor.selectionStart = editor.selectionEnd = prevState.caret;
      updateEditor();
      isUpdating = false;
    }
  }
  // Обработка сохранения (Ctrl+S)
  else if (event.ctrlKey && event.code === 'KeyS') {
    event.preventDefault();
    if (window.showSaveFilePicker) {
      (async () => {
        try {
          const options = {
            types: [{
              description: 'Text Files',
              accept: { 'text/plain': ['.txt'] },
            }],
          };
          const handle = await window.showSaveFilePicker(options);
          const writable = await handle.createWritable();
          await writable.write(editor.value);
          await writable.close();
        } catch (err) {
          console.error("Ошибка сохранения файла: ", err);
        }
      })();
    } else {
      let fileName = prompt("Введите имя файла для сохранения", "document.txt");
      if (fileName) {
        if (!fileName.toLowerCase().endsWith(".txt")) {
          fileName += ".txt";
        }
        const blob = new Blob([editor.value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }
  }
  // Обработка копирования (Ctrl+C) при отсутствии выделения
  else if (event.ctrlKey && event.code === 'KeyC') {
    if (editor.selectionStart === editor.selectionEnd) {
      event.preventDefault();
      const text = editor.value;
      const caretPos = editor.selectionStart;
      const lines = text.split('\n');
      let cumulative = 0;
      let currentLineIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (cumulative + lines[i].length >= caretPos) {
          currentLineIndex = i;
          break;
        }
        cumulative += lines[i].length + 1;
      }
      let currentLine = lines[currentLineIndex];
      const parts = currentLine.split(' = ');
      let result = "";
      if (parts.length > 1) {
        result = parts[1].trim();
      }
      if (result) {
        navigator.clipboard.writeText(result)
          .then(() => {
            console.log("Скопирован результат: " + result);
            showCopyTooltip();
          })
          .catch((err) => console.error("Ошибка копирования: ", err));
      }
    }
  }
  // Обработка вырезания (Ctrl+X) при отсутствии выделения – сохраняем состояние и очищаем поле ввода
  else if (event.ctrlKey && event.code === 'KeyX') {
    if (editor.selectionStart === editor.selectionEnd) {
      event.preventDefault();
      undoStack.push({ text: editor.value, caret: editor.selectionStart });
      editor.value = "";
      editor.dispatchEvent(new Event('input'));
      editor.focus();
    }
  }
  // Обработка удаления текущей строки (Ctrl+K)
  else if (event.ctrlKey && event.code === 'KeyK') {
    event.preventDefault();
    undoStack.push({ text: editor.value, caret: editor.selectionStart });
    const text = editor.value;
    const caretPos = editor.selectionStart;
    const lines = text.split('\n');
    let cumulative = 0;
    let currentLineIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cumulative + lines[i].length >= caretPos) {
        currentLineIndex = i;
        break;
      }
      cumulative += lines[i].length + 1;
    }
    lines.splice(currentLineIndex, 1);
    const newText = lines.join('\n');
    editor.value = newText;
    let newCaretPos = cumulative;
    if (currentLineIndex >= lines.length) {
      newCaretPos = newText.length;
    }
    editor.selectionStart = editor.selectionEnd = newCaretPos;
    editor.dispatchEvent(new Event('input'));
  }
  // Обработка дублирования текущей строки (Ctrl+D)
  else if (event.ctrlKey && event.code === 'KeyD') {
    event.preventDefault();
    undoStack.push({ text: editor.value, caret: editor.selectionStart });
    const text = editor.value;
    const caretPos = editor.selectionStart;
    const lines = text.split('\n');
    let cumulative = 0;
    let currentLineIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cumulative + lines[i].length >= caretPos) {
        currentLineIndex = i;
        break;
      }
      cumulative += lines[i].length + 1;
    }
    const duplicateLine = lines[currentLineIndex];
    lines.splice(currentLineIndex + 1, 0, duplicateLine);
    const newText = lines.join('\n');
    editor.value = newText;
    let newCaretPos = 0;
    for (let i = 0; i <= currentLineIndex; i++) {
      newCaretPos += lines[i].length + 1;
    }
    editor.selectionStart = editor.selectionEnd = newCaretPos;
    editor.dispatchEvent(new Event('input'));
  }
  // Обработка Ctrl+Enter: вставляем пустую строку перед текущей и переводим каретку в начало новой строки
  else if (event.ctrlKey && (event.key === 'Enter' || event.keyCode === 13)) {
    event.preventDefault();
    const text = editor.value;
    const caretPos = editor.selectionStart;
    const lines = text.split('\n');
    let cumulative = 0;
    let currentLineIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cumulative + lines[i].length >= caretPos) {
        currentLineIndex = i;
        break;
      }
      cumulative += lines[i].length + 1;
    }
    lines.splice(currentLineIndex, 0, "");
    const newText = lines.join('\n');
    editor.value = newText;
    let newCaretPos = 0;
    for (let i = 0; i < currentLineIndex; i++) {
      newCaretPos += lines[i].length + 1;
    }
    editor.selectionStart = editor.selectionEnd = newCaretPos;
	
	scrollCaretIntoView();
	
    skipCalculation = true;
  }
  // Обработка Enter (без Ctrl)
  else if (!event.ctrlKey && (event.key === 'Enter' || event.keyCode === 13)) {
    event.preventDefault();
    const text = editor.value;
    const caretPos = editor.selectionStart;
    const nextNewline = text.indexOf('\n', caretPos);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    const newText = text.slice(0, lineEnd) + "\n" + text.slice(lineEnd);
    editor.value = newText;
    editor.selectionStart = editor.selectionEnd = lineEnd + 1;

	scrollCaretIntoView();

    skipCalculation = true;
  }
  // Обработка Ctrl+H: вывод помощи (аналог нажатия на кнопку помощи)
  else if (event.ctrlKey && event.code === 'KeyH') {
    event.preventDefault();
    helpBtn.click();
  }
});

// Функция для автоматического вычисления выражений и обновления редактора
function updateEditor() {
  const originalText = editor.value;
  const originalCaretPos = editor.selectionStart;
  const lines = originalText.split('\n');
  
  let cumulative = 0;
  let caretLine = 0;
  let caretCol = 0;
  for (let i = 0; i < lines.length; i++) {
    if (cumulative + lines[i].length >= originalCaretPos) {
      caretLine = i;
      caretCol = originalCaretPos - cumulative;
      break;
    }
    cumulative += lines[i].length + 1;
  }
  
  let newLines = [];
  let newCaretPos = 0;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let newLine = line;
    if (line.trim() !== '') {
      let parts = line.split(' = ');
      let expr = parts[0];
      if (expr.trim() !== '') {
        try {
          let result = math.evaluate(expr.replace(/\s/g, ''));
		  let out = math.format(result, {notation: 'fixed', precision: 10}).replace(/\.?0+$/, '');
          newLine = `${expr} = ${out}`;
        } catch (error) {
          newLine = expr;
        }
      } else {
        newLine = '';
      }
    }
    newLines.push(newLine);
    if (i < caretLine) {
      newCaretPos += newLine.length + 1;
    } else if (i === caretLine) {
      const sepIndex = newLine.indexOf(' = ');
      let maxPos = sepIndex !== -1 ? sepIndex : newLine.length;
      newCaretPos += Math.min(caretCol, maxPos);
    }
  }
  
  const newText = newLines.join('\n');
  if (newText !== originalText) {
    isUpdating = true;
    editor.value = newText;
    editor.selectionStart = editor.selectionEnd = newCaretPos;
	
	scrollCaretIntoView();
	
    isUpdating = false;
  }
}

// Обработчик события input для автоматического вычисления выражений и сохранения содержимого
editor.addEventListener('input', () => {
  if (skipCalculation) {
    skipCalculation = false;
    localStorage.setItem('editorText', editor.value);
    return;
  }
  
  if (!isUpdating && !restoring) {
    undoStack.push({ text: editor.value, caret: editor.selectionStart });
  } else if (restoring) {
    restoring = false;
  }
  
  updateEditor();
  localStorage.setItem('editorText', editor.value);
});

// Обработчик события paste для удаления символов перевода строки
editor.addEventListener('paste', (event) => {
  event.preventDefault();
  const clipboardData = event.clipboardData || window.clipboardData;
  let pastedText = clipboardData.getData('text/plain');
  pastedText = pastedText.replace(/(\r\n|\n|\r)/gm, '');
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const originalValue = editor.value;
  editor.value = originalValue.slice(0, start) + pastedText + originalValue.slice(end);
  const newCursorPos = start + pastedText.length;
  editor.selectionStart = editor.selectionEnd = newCursorPos;
  editor.dispatchEvent(new Event('input'));
});

// Обработчик для кнопки очистки
const clearBtn = document.getElementById('clear-btn');
clearBtn.addEventListener('click', () => {
  undoStack.push({ text: editor.value, caret: editor.selectionStart });
  editor.value = "";
  editor.dispatchEvent(new Event('input'));
  editor.focus();
});

// Обработчик для кнопки помощи
const helpBtn = document.getElementById('help-btn');
helpBtn.addEventListener('click', () => {
  if (editor.value && !editor.value.endsWith('\n')) {
    editor.value += '\n\n';
  }
  editor.value += `Математические возможности:
https://mathjs.org/docs/expressions/syntax.html

Горячие клавиши:
- Ctrl+C копирует результат строки.
- Ctrl+X или кнопка C очищают всё.
- Ctrl+K удаляет строку.
- Ctrl+D дублирует строку.
- Ctrl+Enter вставляет строку перед текущей.
- Ctrl+S сохраняет всё в файл.
- Ctrl+H выводит помощь.
`;
  editor.dispatchEvent(new Event('input'));
  editor.focus();
  editor.selectionStart = editor.selectionEnd = editor.value.length;
});

// Применяем настройки темы, как в системе
const updateTheme = () => {
  const el_editor = document.getElementById('editor');
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    el_editor.classList.add('dark-theme');
  } else {
    el_editor.classList.remove('dark-theme');
  }
};

updateTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);

// Устанавливаем фокус на редактор после загрузки страницы
editor.focus();
