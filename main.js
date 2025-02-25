// Регистрируем Service Worker для поддержки офлайн-режима и кеширования
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('Service Worker зарегистрирован'))
    .catch(err => console.error('Ошибка регистрации Service Worker:', err));
}

const editor = document.getElementById('editor');

editor.addEventListener('input', () => {
  // Сохраняем исходное содержимое и позицию курсора
  const originalText = editor.value;
  const originalCaretPos = editor.selectionStart;
  
  // Разбиваем текст на строки
  const lines = originalText.split('\n');
  
  // Определяем, в какой строке находится курсор и его позицию в этой строке
  let cumulative = 0;
  let caretLine = 0;
  let caretCol = 0;
  for (let i = 0; i < lines.length; i++) {
    // Если курсор попадает в текущую строку
    if (cumulative + lines[i].length >= originalCaretPos) {
      caretLine = i;
      caretCol = originalCaretPos - cumulative;
      break;
    }
    cumulative += lines[i].length + 1; // +1 для символа новой строки
  }
  
  let newLines = [];
  let newCaretPos = 0;
  
  // Обрабатываем каждую строку по отдельности
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let newLine = line;
    
    // Если строка не пустая
    if (line.trim() !== '') {
      // Если ранее был добавлен результат, удаляем его — берём только часть до " = "
      let parts = line.split(' = ');
      let expr = parts[0];
	  if (expr.trim() !== '') {
        try {
          // Вычисляем выражение с помощью math.js
          let result = math.evaluate(expr.replace(/\s/g, ''));
          newLine = `${expr} = ${result}`;
        } catch (error) {
          // Если выражение ещё не закончено или содержит ошибку,
          // оставляем строку равной исходной (но можно заменить на expr)
          newLine = expr;
        }
      } else {
		  // Чтобы в новую строку не переносился результат из прошлой.
		  newLine = '';
	  }
    }
    newLines.push(newLine);
    
    // Вычисляем новую позицию курсора:
    if (i < caretLine) {
      // Для строк выше строки с курсором суммируем полную длину строки + символ новой строки
      newCaretPos += newLine.length + 1;
    } else if (i === caretLine) {
      // Для строки, где находится курсор, хотим сохранить положение относительно исходного выражения.
      // Если в новой строке добавлено " = результат", позиция курсора не должна выходить за пределы исходного выражения.
      const sepIndex = newLine.indexOf(' = ');
      let maxPos = sepIndex !== -1 ? sepIndex : newLine.length;
      // Если пользователь ввёл меньше символов, чем длина исходного выражения, оставляем его позицию
      newCaretPos += Math.min(caretCol, maxPos);
    }
  }
  
  const newText = newLines.join('\n');
  
  // Если текст изменился, обновляем значение и восстанавливаем позицию курсора
  if (newText !== originalText) {
    editor.value = newText;
    editor.selectionStart = editor.selectionEnd = newCaretPos;
  }
});

editor.addEventListener('paste', (event) => {
  event.preventDefault(); // предотвращаем стандартное поведение вставки
  // Получаем текст из буфера обмена
  const clipboardData = event.clipboardData || window.clipboardData;
  let pastedText = clipboardData.getData('text/plain');
  // Удаляем символы перевода строки
  pastedText = pastedText.replace(/(\r\n|\n|\r)/gm, '');
  
  // Вставляем очищенный текст на место текущей выделенной области
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const originalValue = editor.value;
  editor.value = originalValue.slice(0, start) + pastedText + originalValue.slice(end);
  
  // Обновляем позицию курсора
  const newCursorPos = start + pastedText.length;
  editor.selectionStart = editor.selectionEnd = newCursorPos;
  
  // Генерируем событие input для обновления вычислений
  editor.dispatchEvent(new Event('input'));
});


// Обработчик для кнопки очистки
const clearBtn = document.getElementById('clear-btn');
clearBtn.addEventListener('click', () => {
  editor.value = "";
});

// Обработчик для кнопки помощи
const helpBtn = document.getElementById('help-btn');
helpBtn.addEventListener('click', () => {
  // Если редактор не пустой и не заканчивается переводом строки, добавляем \n
  if (editor.value && !editor.value.endsWith('\n')) {
    editor.value += '\n\n';
  }
  // Добавляем текст
  editor.value += 'Возможности тут: https://mathjs.org/docs/expressions/syntax.html';
  // Обновляем вычисления
  editor.dispatchEvent(new Event('input'));
  // Переводим фокус на редактор и устанавливаем курсор в конец
  editor.focus();
  editor.selectionStart = editor.selectionEnd = editor.value.length;
});

// Применяем настройки темы как в системе
const updateTheme = () => {
  const el_editor = document.getElementById('editor');
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    el_editor.classList.add('dark-theme');
  } else {
    el_editor.classList.remove('dark-theme');
  }
}

// Проверка на загрузке страницы
updateTheme();

// Проверка на изменение системных настроек
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
