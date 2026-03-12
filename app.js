/* =============================================
   School Quiz — Main Application Logic
   ============================================= */

(function () {
  'use strict';

  // ─── Firebase ───────────────────────────────
  const firebaseConfig = {
    databaseURL: 'https://how-to-train-a-dragon-afaed-default-rtdb.europe-west1.firebasedatabase.app/'
  };
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  const scoresRef = db.ref('school-quiz-scores');

  // ─── Difficulty config ──────────────────────
  const DIFFICULTY = {
    easy:   { count: 10, time: 60, label: '⭐ Звёздочка' },
    medium: { count: 15, time: 45, label: '🧠 Знайка' },
    hard:   { count: 20, time: 35, label: '🏆 Эрудит' }
  };

  // ─── State ──────────────────────────────────
  let state = {
    playerName: '',
    difficulty: null,
    questions: [],
    currentIndex: 0,
    score: 0,
    answers: [],       // { question, playerAnswer, correct, timeTaken }
    totalTime: 0,
    timerInterval: null,
    timeLeft: 0,
    questionStartTime: 0,
    currentScreen: 'home',
    currentSessionId: null  // for leaderboard highlight
  };

  // ─── Sound Effects (Web Audio API) ──────────
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function playTone(freq, duration, type, gainVal) {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = gainVal || 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* audio not available */ }
  }

  function soundCorrect() {
    playTone(523, 0.12, 'sine', 0.15);
    setTimeout(() => playTone(659, 0.12, 'sine', 0.15), 100);
    setTimeout(() => playTone(784, 0.2, 'sine', 0.15), 200);
  }

  function soundWrong() {
    playTone(400, 0.15, 'sawtooth', 0.1);
    setTimeout(() => playTone(300, 0.25, 'sawtooth', 0.1), 130);
  }

  function soundTick() {
    playTone(800, 0.05, 'square', 0.05);
  }

  function soundFanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      setTimeout(() => playTone(f, 0.3, 'sine', 0.12), i * 150);
    });
  }

  // ─── Screens ────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById('screen-' + name);
    if (screen) {
      screen.classList.add('active');
      state.currentScreen = name;
    }
  }

  // ─── Home Screen ────────────────────────────
  function initHome() {
    const nameInput = document.getElementById('player-name');

    document.querySelectorAll('.btn-difficulty').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          nameInput.style.borderColor = '#EF4444';
          nameInput.setAttribute('placeholder', 'Напиши своё имя!');
          setTimeout(() => {
            nameInput.style.borderColor = '#E2E8F0';
            nameInput.setAttribute('placeholder', 'Введи своё имя');
          }, 1500);
          return;
        }
        state.playerName = name;
        state.difficulty = btn.dataset.difficulty;
        startGame();
      });
    });

    document.getElementById('btn-leaderboard-home').addEventListener('click', () => {
      showScreen('leaderboard');
      loadLeaderboard();
    });
  }

  // ─── Game Logic ─────────────────────────────
  function startGame() {
    const diff = DIFFICULTY[state.difficulty];
    const pool = QUESTIONS[state.difficulty];
    if (!pool || pool.length === 0) return;

    // Shuffle and pick
    const shuffled = shuffleArray([...pool]);
    state.questions = shuffled.slice(0, Math.min(diff.count, shuffled.length));
    state.currentIndex = 0;
    state.score = 0;
    state.answers = [];
    state.totalTime = 0;
    state.currentSessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    document.getElementById('game-player').textContent = state.playerName;
    document.getElementById('game-score').textContent = '0';

    showScreen('game');
    showQuestion();
  }

  function showQuestion() {
    const q = state.questions[state.currentIndex];
    const diff = DIFFICULTY[state.difficulty];

    // Counter
    document.getElementById('game-counter').textContent =
      `${state.currentIndex + 1}/${state.questions.length}`;

    // Category badge
    const badge = document.getElementById('category-badge');
    badge.textContent = q.categoryLabel;
    badge.setAttribute('data-cat', q.category);

    // Image
    const imgContainer = document.getElementById('question-image-container');
    const imgEl = document.getElementById('question-image');
    if (q.imageId && typeof IMAGE_DATA !== 'undefined' && IMAGE_DATA[q.imageId]) {
      imgEl.src = IMAGE_DATA[q.imageId];
      imgContainer.style.display = 'block';
    } else {
      imgContainer.style.display = 'none';
      imgEl.src = '';
    }

    // Question text
    document.getElementById('question-text').textContent = q.question;

    // Answer area
    const area = document.getElementById('answer-area');
    area.innerHTML = '';

    switch (q.type) {
      case 'multiple_choice':
      case 'image':
        renderMultipleChoice(area, q);
        break;
      case 'true_false':
        renderTrueFalse(area, q);
        break;
      case 'number_input':
        renderNumberInput(area, q);
        break;
      case 'ordering':
        renderOrdering(area, q);
        break;
      default:
        renderMultipleChoice(area, q);
    }

    // Timer
    state.timeLeft = diff.time;
    state.questionStartTime = Date.now();
    startTimer(diff.time);
  }

  function startTimer(totalSeconds) {
    clearInterval(state.timerInterval);
    const timerBar = document.getElementById('timer-bar');
    const timerText = document.getElementById('game-timer-text');

    timerBar.style.width = '100%';
    timerBar.classList.remove('warning');
    timerText.classList.remove('warning');
    timerText.textContent = totalSeconds;

    state.timerInterval = setInterval(() => {
      const elapsed = (Date.now() - state.questionStartTime) / 1000;
      const remaining = Math.max(0, totalSeconds - elapsed);
      const pct = (remaining / totalSeconds) * 100;

      timerBar.style.width = pct + '%';
      timerText.textContent = Math.ceil(remaining);

      if (remaining <= 5) {
        timerBar.classList.add('warning');
        timerText.classList.add('warning');
        if (remaining > 0 && Math.ceil(remaining) !== Math.ceil(remaining + 0.1)) {
          soundTick();
        }
      }

      if (remaining <= 0) {
        clearInterval(state.timerInterval);
        handleTimeout();
      }
    }, 100);
  }

  function handleTimeout() {
    const q = state.questions[state.currentIndex];
    const timeTaken = DIFFICULTY[state.difficulty].time;

    state.answers.push({
      question: q,
      playerAnswer: null,
      correct: false,
      timeTaken
    });

    soundWrong();
    showExplanation(false, q.explanation || 'Время вышло!');
  }

  function handleAnswer(isCorrect, playerAnswer) {
    clearInterval(state.timerInterval);
    const q = state.questions[state.currentIndex];
    const timeTaken = (Date.now() - state.questionStartTime) / 1000;

    if (isCorrect) {
      state.score++;
      document.getElementById('game-score').textContent = state.score;
      soundCorrect();
    } else {
      soundWrong();
    }

    state.answers.push({
      question: q,
      playerAnswer,
      correct: isCorrect,
      timeTaken
    });
    state.totalTime += timeTaken;

    showExplanation(isCorrect, q.explanation);
  }

  function showExplanation(isCorrect, text) {
    const overlay = document.getElementById('explanation-overlay');
    document.getElementById('explanation-icon').textContent = isCorrect ? '✅' : '❌';
    document.getElementById('explanation-text').textContent = text || '';
    overlay.classList.add('active');

    setTimeout(() => {
      overlay.classList.remove('active');
      state.currentIndex++;
      if (state.currentIndex < state.questions.length) {
        showQuestion();
      } else {
        endGame();
      }
    }, 2500);
  }

  function endGame() {
    clearInterval(state.timerInterval);
    soundFanfare();

    const total = state.questions.length;
    const pct = state.score / total;

    // Stars
    let stars = '';
    if (pct >= 0.9) stars = '⭐⭐⭐';
    else if (pct >= 0.6) stars = '⭐⭐';
    else stars = '⭐';

    // Title
    let title = '';
    if (pct >= 0.9) title = 'Превосходно!';
    else if (pct >= 0.7) title = 'Отлично!';
    else if (pct >= 0.5) title = 'Хорошо!';
    else title = 'Попробуй ещё раз!';

    document.getElementById('results-stars').textContent = stars;
    document.getElementById('results-title').textContent = title;
    document.getElementById('results-score').textContent =
      `Правильных: ${state.score} из ${total}`;
    document.getElementById('results-time').textContent =
      `Общее время: ${formatTime(state.totalTime)}`;

    // Hide review on initial show
    document.getElementById('review-section').style.display = 'none';

    showScreen('results');
    saveScore();
  }

  // ─── Answer Renderers ──────────────────────

  function renderMultipleChoice(area, q) {
    const grid = document.createElement('div');
    grid.className = 'answer-grid';
    const letters = ['А', 'Б', 'В', 'Г'];

    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-answer';
      btn.innerHTML = `<span class="answer-letter">${letters[i]}</span>${escapeHtml(opt)}`;
      btn.addEventListener('click', () => {
        const isCorrect = i === q.correct;
        // Highlight
        grid.querySelectorAll('.btn-answer').forEach(b => b.classList.add('disabled'));
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        if (!isCorrect) {
          grid.querySelectorAll('.btn-answer')[q.correct].classList.add('correct');
        }
        handleAnswer(isCorrect, opt);
      });
      grid.appendChild(btn);
    });
    area.appendChild(grid);
  }

  function renderTrueFalse(area, q) {
    const grid = document.createElement('div');
    grid.className = 'tf-grid';

    ['Правда', 'Неправда'].forEach((label, i) => {
      const val = i === 0;
      const btn = document.createElement('button');
      btn.className = 'btn btn-answer btn-tf';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const isCorrect = val === q.correct;
        grid.querySelectorAll('.btn-answer').forEach(b => b.classList.add('disabled'));
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        if (!isCorrect) {
          grid.querySelectorAll('.btn-answer')[val === q.correct ? 0 : 1].classList.add('correct');
        }
        handleAnswer(isCorrect, label);
      });
      grid.appendChild(btn);
    });
    area.appendChild(grid);
  }

  function renderNumberInput(area, q) {
    const wrap = document.createElement('div');
    wrap.className = 'number-input-area';

    const display = document.createElement('input');
    display.type = 'text';
    display.className = 'number-display';
    display.readOnly = true;
    display.value = '';
    wrap.appendChild(display);

    const numpad = document.createElement('div');
    numpad.className = 'numpad';

    let currentValue = '';

    const updateDisplay = () => {
      display.value = currentValue;
    };

    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.className = 'btn-numpad';
      btn.textContent = n;
      btn.addEventListener('click', () => {
        if (currentValue.length < 10) {
          currentValue += n;
          updateDisplay();
        }
      });
      numpad.appendChild(btn);
    }

    // Row: Clear, 0, Submit
    const btnClear = document.createElement('button');
    btnClear.className = 'btn-numpad btn-numpad-clear';
    btnClear.textContent = '⌫';
    btnClear.addEventListener('click', () => {
      currentValue = currentValue.slice(0, -1);
      updateDisplay();
    });
    numpad.appendChild(btnClear);

    const btn0 = document.createElement('button');
    btn0.className = 'btn-numpad';
    btn0.textContent = '0';
    btn0.addEventListener('click', () => {
      if (currentValue.length < 10) {
        currentValue += '0';
        updateDisplay();
      }
    });
    numpad.appendChild(btn0);

    const btnSubmit = document.createElement('button');
    btnSubmit.className = 'btn-numpad btn-numpad-submit';
    btnSubmit.textContent = '✓';
    btnSubmit.addEventListener('click', () => {
      if (!currentValue) return;
      const num = parseFloat(currentValue);
      const isCorrect = num === q.correct;
      numpad.querySelectorAll('.btn-numpad').forEach(b => b.disabled = true);
      display.style.borderColor = isCorrect ? '#10B981' : '#EF4444';
      display.style.color = isCorrect ? '#10B981' : '#EF4444';
      handleAnswer(isCorrect, currentValue);
    });
    numpad.appendChild(btnSubmit);

    // Minus button for negative numbers
    const btnMinus = document.createElement('button');
    btnMinus.className = 'btn-numpad';
    btnMinus.textContent = '−';
    btnMinus.addEventListener('click', () => {
      if (currentValue.startsWith('-')) {
        currentValue = currentValue.slice(1);
      } else {
        currentValue = '-' + currentValue;
      }
      updateDisplay();
    });
    numpad.appendChild(btnMinus);

    wrap.appendChild(numpad);
    area.appendChild(wrap);
  }

  function renderOrdering(area, q) {
    const wrap = document.createElement('div');
    wrap.className = 'ordering-area';

    const instruction = document.createElement('div');
    instruction.className = 'ordering-instruction';
    instruction.textContent = 'Нажимай на элементы в правильном порядке:';
    wrap.appendChild(instruction);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'ordering-items';

    let selectedOrder = [];
    const items = q.items.map((text, originalIndex) => ({ text, originalIndex }));

    function renderItems() {
      itemsContainer.innerHTML = '';
      items.forEach((item, displayIndex) => {
        const div = document.createElement('div');
        div.className = 'ordering-item';

        const orderPos = selectedOrder.indexOf(displayIndex);
        const badge = document.createElement('span');
        badge.className = 'order-badge';
        if (orderPos >= 0) {
          badge.classList.add('filled');
          badge.textContent = orderPos + 1;
          div.classList.add('selected');
        } else {
          badge.textContent = '?';
        }

        div.appendChild(badge);
        const textSpan = document.createElement('span');
        textSpan.textContent = item.text;
        div.appendChild(textSpan);

        div.addEventListener('click', () => {
          const idx = selectedOrder.indexOf(displayIndex);
          if (idx >= 0) {
            // Deselect: remove this and all after it
            selectedOrder = selectedOrder.slice(0, idx);
          } else {
            selectedOrder.push(displayIndex);
          }
          renderItems();
          submitBtn.disabled = selectedOrder.length !== items.length;
        });

        itemsContainer.appendChild(div);
      });
    }

    wrap.appendChild(itemsContainer);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '8px';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-ordering-reset';
    resetBtn.textContent = 'Сбросить';
    resetBtn.style.flex = '1';
    resetBtn.addEventListener('click', () => {
      selectedOrder = [];
      renderItems();
      submitBtn.disabled = true;
    });

    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-ordering-submit';
    submitBtn.textContent = 'Проверить';
    submitBtn.disabled = true;
    submitBtn.style.flex = '2';
    submitBtn.addEventListener('click', () => {
      // Check if selectedOrder matches correctOrder
      const isCorrect = q.correctOrder.every((correctIdx, pos) =>
        selectedOrder[pos] === correctIdx
      );

      // Show correct/wrong on items
      const itemDivs = itemsContainer.querySelectorAll('.ordering-item');
      selectedOrder.forEach((displayIdx, pos) => {
        if (displayIdx === q.correctOrder[pos]) {
          itemDivs[displayIdx].classList.add('correct');
        } else {
          itemDivs[displayIdx].classList.add('wrong');
        }
      });

      submitBtn.disabled = true;
      resetBtn.disabled = true;
      handleAnswer(isCorrect, selectedOrder.map(i => items[i].text).join(' → '));
    });

    btnRow.appendChild(resetBtn);
    btnRow.appendChild(submitBtn);
    wrap.appendChild(btnRow);

    renderItems();
    area.appendChild(wrap);
  }

  // ─── Results Screen ─────────────────────────

  function initResults() {
    document.getElementById('btn-review').addEventListener('click', () => {
      const section = document.getElementById('review-section');
      if (section.style.display === 'none') {
        section.style.display = 'block';
        renderReview();
        document.getElementById('btn-review').textContent = '📝 Скрыть ответы';
      } else {
        section.style.display = 'none';
        document.getElementById('btn-review').textContent = '📝 Посмотреть ответы';
      }
    });

    document.getElementById('btn-leaderboard-results').addEventListener('click', () => {
      showScreen('leaderboard');
      loadLeaderboard();
    });

    document.getElementById('btn-play-again').addEventListener('click', () => {
      showScreen('home');
    });
  }

  function renderReview() {
    const list = document.getElementById('review-list');
    list.innerHTML = '';

    state.answers.forEach((a, i) => {
      const div = document.createElement('div');
      div.className = 'review-item' + (a.correct ? '' : ' wrong');

      let answerText = '';
      if (a.correct) {
        answerText = `<span class="correct-answer">✓ Правильно</span>`;
      } else if (a.playerAnswer === null) {
        answerText = `<span class="wrong-answer">Время вышло</span>`;
      } else {
        const correctText = getCorrectAnswerText(a.question);
        answerText = `<span class="wrong-answer">${escapeHtml(String(a.playerAnswer))}</span> → <span class="correct-answer">${escapeHtml(correctText)}</span>`;
      }

      div.innerHTML = `
        <div class="review-q">${i + 1}. ${escapeHtml(a.question.question)}</div>
        <div class="review-a">${answerText}</div>
      `;
      list.appendChild(div);
    });
  }

  function getCorrectAnswerText(q) {
    switch (q.type) {
      case 'multiple_choice':
      case 'image':
        return q.options[q.correct];
      case 'true_false':
        return q.correct ? 'Правда' : 'Неправда';
      case 'number_input':
        return String(q.correct);
      case 'ordering':
        return q.correctOrder.map(i => q.items[i]).join(' → ');
      default:
        return String(q.correct);
    }
  }

  // ─── Leaderboard ────────────────────────────

  function initLeaderboard() {
    document.querySelectorAll('.btn-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadLeaderboard(btn.dataset.filter);
      });
    });

    document.getElementById('btn-back-from-leaderboard').addEventListener('click', () => {
      if (state.answers.length > 0) {
        showScreen('results');
      } else {
        showScreen('home');
      }
    });
  }

  function saveScore() {
    const data = {
      name: state.playerName,
      score: state.score,
      total: state.questions.length,
      difficulty: state.difficulty,
      time: Math.round(state.totalTime),
      sessionId: state.currentSessionId,
      timestamp: Date.now()
    };

    scoresRef.push(data).catch(err => {
      console.warn('Failed to save score:', err);
    });
  }

  function loadLeaderboard(filter) {
    filter = filter || 'all';
    const tbody = document.getElementById('leaderboard-body');
    const empty = document.getElementById('leaderboard-empty');
    const loading = document.getElementById('leaderboard-loading');

    tbody.innerHTML = '';
    empty.style.display = 'none';
    loading.style.display = 'block';

    scoresRef.orderByChild('timestamp').limitToLast(100).once('value')
      .then(snapshot => {
        loading.style.display = 'none';
        const entries = [];
        snapshot.forEach(child => {
          const val = child.val();
          if (filter === 'all' || val.difficulty === filter) {
            entries.push(val);
          }
        });

        // Sort by score desc, then by time asc
        entries.sort((a, b) => {
          const pctA = a.score / a.total;
          const pctB = b.score / b.total;
          if (pctB !== pctA) return pctB - pctA;
          return a.time - b.time;
        });

        if (entries.length === 0) {
          empty.style.display = 'block';
          return;
        }

        entries.slice(0, 50).forEach((entry, i) => {
          const tr = document.createElement('tr');
          if (entry.sessionId === state.currentSessionId) {
            tr.className = 'current-player';
          }

          let rank = '';
          if (i === 0) rank = '🥇';
          else if (i === 1) rank = '🥈';
          else if (i === 2) rank = '🥉';
          else rank = String(i + 1);

          const diffIcon = entry.difficulty === 'easy' ? '⭐' :
                           entry.difficulty === 'medium' ? '🧠' : '🏆';

          tr.innerHTML = `
            <td>${rank}</td>
            <td>${escapeHtml(entry.name)} ${diffIcon}</td>
            <td>${entry.score}/${entry.total}</td>
            <td>${formatTime(entry.time)}</td>
          `;
          tbody.appendChild(tr);
        });
      })
      .catch(err => {
        loading.style.display = 'none';
        empty.textContent = 'Ошибка загрузки';
        empty.style.display = 'block';
        console.warn('Leaderboard error:', err);
      });
  }

  // ─── Utils ──────────────────────────────────

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m > 0) return `${m} мин ${s} сек`;
    return `${s} сек`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── PWA Registration ──────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // ─── Init ───────────────────────────────────
  initHome();
  initResults();
  initLeaderboard();

})();
