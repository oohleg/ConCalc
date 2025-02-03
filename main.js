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
      let expr = parts[0].trim();
      if (expr !== '') {
        try {
          // Вычисляем выражение с помощью math.js (math.js корректно обрабатывает оператор '^')
          let result = math.evaluate(expr);
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

// Применяем настройки темы как в системе
const updateTheme = () => {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.body.textarea.classList.add('dark-theme');
  } else {
    document.body.textarea.classList.remove('dark-theme');
  }
}

// Проверка на загрузке страницы
updateTheme();

// Проверка на изменение системных настроек
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
