const DEFAULT_TASKS = [];

const REWARDS = {
  claw: ["5 minute break", "25 gems", "15 tickets", "10 gems"],
  wheel: ["5 minute break", "25 gems", "10 tickets", "15 gems", "25 tickets", "10 gems"],
  tickets: ["25 tickets", "10 tickets", "50 tickets", "15 tickets"]
};

const TICKET_VALUES = [5, 10, 15, 25, 50];
const TICKET_JACKPOT_CHANCE = 0.01;
const TICKET_MAX_CHANCES = 3;
const PROGRESS_STORAGE_KEY = "playtime-progress";
const DAILY_REWARD_STORAGE_KEY = "playtime-daily-reward";
const DAILY_REWARDS = [
  { day: 1, reward: "5 tickets", short: "5 TIX" },
  { day: 2, reward: "5 minute break", short: "5 MIN" },
  { day: 3, reward: "30 tickets", short: "30 TIX" },
  { day: 4, reward: "100 gems", short: "100 GEM" },
  { day: 5, reward: "500 tickets", short: "500 TIX" }
];

const state = {
  tasks: structuredClone(DEFAULT_TASKS),
  gems: 25,
  tickets: 12,
  breaks: 0,
  currentTask: null,
  currentGame: null,
  timer: 0,
  timerInterval: null,
  playCompleted: false,
  gameBusy: false,
  clawPosition: 50,
  clawDropped: false,
  clawChanceUsed: false,
  gameChanceUsed: { claw: false, wheel: false, tickets: false },
  clawRaiseTimer: null,
  clawRewardTimer: null,
  ticketJackpot: false,
  ticketSpinCount: 0,
  jackpotTimer: null,
  rainStartTimer: null,
  rainFrame: null,
  dailyReward: { lastClaimed: "", streak: 0 },
  breakSeconds: 0,
  breakInterval: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY));
    if (!saved || !Array.isArray(saved.tasks)) return { tasks: structuredClone(DEFAULT_TASKS), gems: 25, tickets: 12, breaks: 0 };
    return {
      tasks: saved.tasks.map((task) => ({ id: task.id, title: String(task.title), detail: String(task.detail || "Focus round"), done: Boolean(task.done) })),
      gems: Number.isFinite(saved.gems) ? Math.max(0, saved.gems) : 25,
      tickets: Number.isFinite(saved.tickets) ? Math.max(0, saved.tickets) : 12,
      breaks: Number.isFinite(saved.breaks) ? Math.max(0, saved.breaks) : 0
    };
  } catch (error) {
    return { tasks: structuredClone(DEFAULT_TASKS), gems: 25, tickets: 12, breaks: 0 };
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({ tasks: state.tasks, gems: state.gems, tickets: state.tickets, breaks: state.breaks }));
  } catch (error) {
    // The arcade still works for this visit if browser storage is unavailable.
  }
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  return Math.round((end - start) / 86400000);
}

function loadDailyReward() {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_REWARD_STORAGE_KEY));
    if (!saved || typeof saved.lastClaimed !== "string" || !Number.isInteger(saved.streak)) return { lastClaimed: "", streak: 0 };
    return { lastClaimed: saved.lastClaimed, streak: Math.max(1, Math.min(5, saved.streak)) };
  } catch (error) {
    return { lastClaimed: "", streak: 0 };
  }
}

function saveDailyReward() {
  try {
    localStorage.setItem(DAILY_REWARD_STORAGE_KEY, JSON.stringify(state.dailyReward));
  } catch (error) {
    // The reward still works for this visit if browser storage is unavailable.
  }
}

function getDailyRewardStatus() {
  const today = getDateKey();
  const record = state.dailyReward;
  const gap = record.lastClaimed ? daysBetween(record.lastClaimed, today) : null;
  const claimedToday = gap === 0;
  let day = 1;
  if (claimedToday) day = record.streak;
  if (gap === 1) day = record.streak >= DAILY_REWARDS.length ? 1 : record.streak + 1;
  return { today, claimedToday, day: Math.max(1, Math.min(DAILY_REWARDS.length, day)) };
}

function renderDailyReward() {
  const status = getDailyRewardStatus();
  const reward = DAILY_REWARDS[status.day - 1];
  const nextDay = status.day === DAILY_REWARDS.length ? 1 : status.day + 1;
  const track = $("#dailyRewardTrack");
  track.innerHTML = DAILY_REWARDS.map((item) => {
    const complete = status.claimedToday ? item.day <= status.day : item.day < status.day;
    const current = item.day === status.day;
    return `<div class="daily-reward-day${complete ? " complete" : ""}${current ? " current" : ""}"><span>DAY ${item.day}</span><strong>${item.short}</strong></div>`;
  }).join("");
  $("#dailyRewardTitle").textContent = status.claimedToday ? `Day ${status.day} claimed` : `Day ${status.day} reward`;
  $("#dailyRewardCopy").textContent = status.claimedToday
    ? `Nice! Come back tomorrow for Day ${nextDay}: ${DAILY_REWARDS[nextDay - 1].reward}.`
    : `Today's reward is ${reward.reward}. Keep your streak going.`;
  const claimButton = $("#claimDailyReward");
  claimButton.disabled = status.claimedToday;
  claimButton.style.opacity = status.claimedToday ? ".55" : "1";
  claimButton.innerHTML = status.claimedToday ? 'Claimed today <span>✓</span>' : 'Claim today’s reward <span>✦</span>';
}

function openDailyReward() {
  renderDailyReward();
  $("#dailyRewardOverlay").hidden = false;
}

function claimDailyReward() {
  const status = getDailyRewardStatus();
  if (status.claimedToday) return;
  const reward = DAILY_REWARDS[status.day - 1];
  state.dailyReward = { lastClaimed: status.today, streak: status.day };
  saveDailyReward();
  applyReward(reward.reward);
  renderDailyReward();
  showToast(`Day ${status.day} reward: ${reward.reward}`);
}

function formatBreakTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function openBreakModal() {
  clearInterval(state.breakInterval);
  $("#restTimer").textContent = formatBreakTime(state.breaks * 60);
  $("#breakModalCopy").textContent = state.breaks > 0
    ? `You have ${state.breaks} minute${state.breaks === 1 ? "" : "s"} ready. Take it whenever you need it.`
    : "You do not have break time yet. Buy extra time below when you need it.";
  $("#startBreak").hidden = false;
  $("#startBreak").disabled = state.breaks <= 0;
  $("#startBreak").style.opacity = state.breaks > 0 ? "1" : ".5";
  $("#finishBreak").hidden = true;
  $("#extraBreakOptions").hidden = true;
  $("#breakPurchaseMessage").textContent = "";
  $("#breakOverlay").hidden = false;
}

function toggleExtraBreakOptions() {
  const options = $("#extraBreakOptions");
  options.hidden = !options.hidden;
  $("#breakPurchaseMessage").textContent = "";
}

function buyExtraBreak(minutes, cost) {
  if (state.tickets < cost || state.gems < cost) {
    $("#breakPurchaseMessage").textContent = "Not enough tickets and gems.";
    $("#breakPurchaseMessage").classList.add("error");
    showToast("Not enough tickets and gems");
    return;
  }
  state.tickets -= cost;
  state.gems -= cost;
  state.breaks += minutes;
  updateStats();
  $("#breakPurchaseMessage").classList.remove("error");
  $("#breakPurchaseMessage").textContent = `Added ${minutes} minutes to your break bank.`;
  $("#breakModalCopy").textContent = `You have ${state.breaks} minutes ready. Take it whenever you need it.`;
  $("#restTimer").textContent = formatBreakTime(state.breaks * 60);
  $("#startBreak").disabled = false;
  $("#startBreak").style.opacity = "1";
  showToast(`${minutes} minute break added`);
}

function finishBreak() {
  clearInterval(state.breakInterval);
  state.breakInterval = null;
  $("#breakOverlay").hidden = true;
  $("#startBreak").hidden = false;
  $("#finishBreak").hidden = true;
  showView("focus");
  showToast("Break complete — welcome back to the lobby");
}

function startBreak() {
  if (state.breaks <= 0 || state.breakInterval) return;
  state.breakSeconds = state.breaks * 60;
  state.breaks = 0;
  updateStats();
  $("#startBreak").hidden = true;
  $("#finishBreak").hidden = false;
  $("#breakModalCopy").textContent = "Your break is running. Come back when the timer reaches zero.";
  $("#restTimer").textContent = formatBreakTime(state.breakSeconds);
  state.breakInterval = setInterval(() => {
    state.breakSeconds -= 1;
    $("#restTimer").textContent = formatBreakTime(Math.max(0, state.breakSeconds));
    if (state.breakSeconds <= 0) finishBreak();
  }, 1000);
}

function renderTasks() {
  const list = $("#taskList");
  const empty = $("#emptyState");
  const done = state.tasks.filter((task) => task.done).length;
  $("#taskCount").textContent = `${done} / ${state.tasks.length}`;
  $("#progressFill").style.width = state.tasks.length ? `${(done / state.tasks.length) * 100}%` : "0%";
  list.innerHTML = "";
  empty.hidden = state.tasks.length !== 0;

  state.tasks.forEach((task) => {
    const item = document.createElement("div");
    item.className = `task-item${task.done ? " done" : ""}`;
    item.innerHTML = `<button class="task-check" aria-label="${task.done ? "Completed" : "Incomplete"}" type="button">${task.done ? "✓" : ""}</button><div class="task-meta"><p class="task-name">${escapeHtml(task.title)}</p><p class="task-detail">${task.done ? "Reward claimed" : escapeHtml(task.detail)}</p></div>${task.done ? "" : `<button class="task-start" type="button">Start →</button>`}`;
    const start = item.querySelector(".task-start");
    if (start) start.addEventListener("click", () => openTask(task));
    list.appendChild(item);
  });

  const next = state.tasks.find((task) => !task.done);
  $("#nextTaskName").textContent = next ? next.title : "All tasks are clear";
  $("#nextTaskCopy").textContent = next ? `${state.tasks.filter((task) => !task.done).length} round${state.tasks.filter((task) => !task.done).length === 1 ? "" : "s"} left in your queue.` : "Your focus floor is looking good.";
  $("#startNextTask").disabled = !next;
  $("#startNextTask").style.opacity = next ? "1" : ".55";
  updateStats();
}

function updateStats() {
  $("#gemsCount").textContent = state.gems;
  $("#ticketsCount").textContent = state.tickets;
  $("#breakCount").textContent = `${state.breaks} min`;
  $("#breakProgress").style.width = `${Math.min(100, state.breaks * 3.33)}%`;
  $("#stashGems").textContent = state.gems;
  $("#shelfTickets").textContent = state.tickets;
  $("#shelfBreak").textContent = state.breaks;
  const breakButton = $("#breakCount");
  breakButton.disabled = false;
  breakButton.style.opacity = state.breaks > 0 ? "1" : ".5";
  saveProgress();
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

function showView(view) {
  $$(".page-view").forEach((page) => page.classList.toggle("active-view", page.dataset.page === view));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openTask(task) {
  if (!task || task.done) return;
  state.currentTask = task;
  state.timer = 0;
  state.clawChanceUsed = false;
  state.ticketSpinCount = 0;
  state.gameChanceUsed = { claw: false, wheel: false, tickets: false };
  $("#taskModalTitle").textContent = task.title;
  $("#focusTimer").textContent = "00:00";
  showTaskStep("timer");
  $("#taskOverlay").hidden = false;
  startTimer();
}

function startTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.timer += 1;
    const minutes = String(Math.floor(state.timer / 60)).padStart(2, "0");
    const seconds = String(state.timer % 60).padStart(2, "0");
    $("#focusTimer").textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function showTaskStep(step) {
  $("#timerStep").hidden = step !== "timer";
  $("#confirmStep").hidden = step !== "confirm";
  $("#arcadeStep").hidden = step !== "arcade";
}

function askIfDone() {
  if (!state.currentTask) return;
  clearInterval(state.timerInterval);
  showTaskStep("confirm");
}

function returnToTimer() {
  showTaskStep("timer");
  startTimer();
}

function confirmTaskDone() {
  if (!state.currentTask) return;
  clearInterval(state.timerInterval);
  state.currentTask.done = true;
  state.playCompleted = false;
  renderTasks();
  showTaskStep("arcade");
}

function goToArcade() {
  $("#taskOverlay").hidden = true;
  $("#rewardOverlay").hidden = false;
}

function openGame(game) {
  if (!game) return;
  state.currentGame = game;
  state.gameBusy = false;
  clearTimeout(state.jackpotTimer);
  clearTimeout(state.rainStartTimer);
  cancelAnimationFrame(state.rainFrame);
  state.rainFrame = null;
  $("#rewardOverlay").hidden = true;
  $("#gameOverlay").hidden = false;
  $("#jackpotCelebration").hidden = true;
  $("#confettiField").innerHTML = "";
  $("#gameResult").hidden = true;
  $("#gameAction").disabled = false;
  $("#gameAction").style.opacity = "1";
  $("#gameAction").innerHTML = game === "claw" ? 'Drop the claw <span>↓</span>' : game === "wheel" ? 'Spin for a reward <span>↻</span>' : 'Pull the lever <span>↓</span>';
  $("#gameTitle").textContent = game === "claw" ? "Lucky claw" : game === "wheel" ? "Spin cycle" : "Ticket drop";
  $("#gameSubtitle").textContent = game === "claw" ? "Take a shot at a surprise reward." : game === "wheel" ? "No wrong turns in this machine." : "Three little reels. One bigger stack.";
  $("#gameKicker").textContent = game === "claw" ? "Prize grabber" : game === "wheel" ? "Prize spinner" : "Ticket counter";
  $("#gameArea").innerHTML = gameMarkup(game);
  if (game === "claw") setupClaw();
  if (game === "tickets") setTicketPreview();
  if (game !== "tickets" && ((game === "claw" && state.clawChanceUsed) || state.gameChanceUsed[game])) {
    $("#gameAction").innerHTML = 'Chance used <span>✓</span>';
    $("#gameAction").disabled = true;
    $("#gameAction").style.opacity = ".55";
  }
}

function gameMarkup(game) {
  if (game === "claw") return `<div class="game-area claw-game" tabindex="0" role="application" aria-label="Lucky claw. Use left and right arrow keys to move the claw, down to drop, and up to raise it."><div class="claw-instructions"><strong>LUCKY CLAW</strong><span>← → MOVE &nbsp; ↓ DROP &nbsp; ↑ RAISE</span></div><div class="claw-track"><div class="claw-trolley"><div class="claw-cable"></div><div class="claw-grabber"><i></i><i></i></div></div></div><div class="game-glass"><div class="claw-reflection"></div><div class="game-capsule capsule-yellow"></div><div class="game-capsule capsule-blue"></div><div class="game-capsule capsule-mint"></div><div class="game-capsule capsule-lilac"></div><div class="game-stars">✦　✦</div></div><div class="claw-floor"></div></div>`;
  if (game === "wheel") return `<div class="game-area wheel-game"><div class="game-wheel"><div class="game-wheel-center">GO</div></div><div class="game-wheel-pointer"></div></div>`;
  const ticketSequence = Array.from({ length: 8 }, () => TICKET_VALUES).flat();
  return `<div class="game-area ticket-game"><div class="ticket-game-title">TRY TO GET THE 1% JACKPOT!!!</div><div class="reels">${[0, 1, 2].map(() => `<div class="reel"><div class="reel-strip">${ticketSequence.map((number) => `<span>${number}</span>`).join("")}</div></div>`).join("")}</div><div class="ticket-slot-game"></div><div class="ticket-lever"><span>↓</span></div></div>`;
}

function setTicketPreview() {
  $("#gameArea").querySelectorAll(".reel-strip").forEach((strip, index) => {
    strip.style.transform = `translateY(-${Math.floor(Math.random() * TICKET_VALUES.length) * 94}px)`;
  });
}

function setupClaw() {
  state.clawPosition = 50;
  state.clawDropped = false;
  clearTimeout(state.clawRaiseTimer);
  clearTimeout(state.clawRewardTimer);
  const clawGame = $(".claw-game");
  const trolley = $(".claw-trolley");
  trolley.style.left = `${state.clawPosition}%`;
  clawGame.focus();
}

function moveClaw(direction) {
  if (state.gameBusy || state.clawDropped || state.currentGame !== "claw") return;
  state.clawPosition = Math.max(12, Math.min(88, state.clawPosition + direction * 5));
  $(".claw-trolley").style.left = `${state.clawPosition}%`;
  $(".claw-game").classList.remove("claw-nudge-left", "claw-nudge-right");
  $(".claw-game").classList.add(direction < 0 ? "claw-nudge-left" : "claw-nudge-right");
}

function dropClaw() {
  if (state.gameBusy || state.clawDropped || state.clawChanceUsed || state.currentGame !== "claw") return;
  state.gameBusy = true;
  state.clawDropped = true;
  state.clawChanceUsed = true;
  state.gameChanceUsed.claw = true;
  $(".claw-game").classList.add("claw-dropping");
  $("#gameAction").disabled = true;
  $("#gameAction").style.opacity = ".6";
  state.clawRaiseTimer = setTimeout(() => {
    $(".claw-game").classList.remove("claw-dropping");
    $(".claw-game").classList.add("claw-returning");
    state.clawRewardTimer = setTimeout(() => {
      $(".claw-game").classList.remove("claw-returning");
      const options = REWARDS.claw;
      const reward = options[Math.floor(Math.random() * options.length)];
      applyReward(reward);
      $("#resultText").textContent = reward;
      $("#gameResult").hidden = false;
      $("#gameAction").innerHTML = 'Chance used <span>✓</span>';
      $("#gameAction").disabled = true;
      $("#gameAction").style.opacity = ".55";
      state.clawDropped = false;
      state.gameBusy = false;
    }, 900);
  }, 1450);
}

function raiseClaw() {
  if (state.currentGame !== "claw" || !state.clawDropped) return;
  clearTimeout(state.clawRaiseTimer);
  clearTimeout(state.clawRewardTimer);
  $(".claw-game").classList.remove("claw-dropping", "claw-returning");
  state.clawDropped = false;
  state.gameBusy = false;
  $("#gameAction").disabled = true;
  $("#gameAction").style.opacity = ".55";
  $("#gameAction").innerHTML = 'Chance used <span>✓</span>';
}

function handleClawKeydown(event) {
  if ($("#gameOverlay").hidden || state.currentGame !== "claw") return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
  if (event.key === "ArrowLeft") moveClaw(-1);
  if (event.key === "ArrowRight") moveClaw(1);
  if (event.key === "ArrowDown") dropClaw();
  if (event.key === "ArrowUp") raiseClaw();
}

function spinTicketReels() {
  state.ticketSpinCount += 1;
  const jackpotIndex = Math.floor(Math.random() * TICKET_VALUES.length);
  const shouldHitJackpot = Math.random() < TICKET_JACKPOT_CHANCE;
  const targetIndexes = shouldHitJackpot
    ? [jackpotIndex, jackpotIndex, jackpotIndex]
    : [jackpotIndex, (jackpotIndex + 1) % TICKET_VALUES.length, (jackpotIndex + 2) % TICKET_VALUES.length];
  state.ticketJackpot = targetIndexes.every((index) => index === targetIndexes[0]);
  const reels = $$(".reel");
  $(".ticket-game").classList.add("is-spinning");
  reels.forEach((reel, index) => {
    const strip = reel.querySelector(".reel-strip");
    strip.classList.add("spinning");
    strip.style.transition = "none";
    strip.style.transform = "translateY(0)";
    void strip.offsetHeight;
    const stopAt = (index + 3) * TICKET_VALUES.length + targetIndexes[index];
    strip.style.transition = `transform ${1900 + index * 240}ms cubic-bezier(.15,.78,.15,1)`;
    strip.style.transform = `translateY(-${stopAt * 94}px)`;
    setTimeout(() => strip.classList.remove("spinning"), 1940 + index * 240);
  });
  return 2380;
}

function showJackpotCelebration() {
  const celebration = $("#jackpotCelebration");
  const field = $("#confettiField");
  const colors = ["#f8e45b", "#f4a9cf", "#a9d4fa", "#bde8d3", "#c5b9f4", "#ff9f58", "#ffffff"];
  field.innerHTML = '<div class="confetti-burst-layer"></div><div class="confetti-rain-layer rain-back"></div><div class="confetti-rain-layer rain-front"></div>';
  const burstLayer = field.querySelector(".confetti-burst-layer");
  const backRain = field.querySelector(".rain-back");
  const frontRain = field.querySelector(".rain-front");
    for (let index = 0; index < 112; index += 1) {
    const piece = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const distance = 170 + Math.random() * 310;
    piece.className = "confetti-piece";
    piece.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    piece.style.setProperty("--r", `${Math.round(Math.random() * 900 - 450)}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 120}ms`);
    piece.style.setProperty("--color", colors[index % colors.length]);
    piece.style.setProperty("--duration", `${1.8 + Math.random() * 1.4}s`);
    burstLayer.appendChild(piece);
  }
  const spawnRainPiece = () => {
    if (celebration.hidden) return;
    const piece = document.createElement("i");
    const isFront = Math.random() < .24;
    const left = Math.random() * 100;
    const layer = isFront ? frontRain : backRain;
    const duration = 2.9 + Math.random() * 1.1;
    piece.className = `rain-confetti-piece${isFront ? " front-rain-piece" : ""}`;
    piece.style.setProperty("--left", `${left}%`);
    piece.style.setProperty("--sway", `${Math.round(Math.random() * (isFront ? 80 : 120) - (isFront ? 40 : 60))}px`);
    piece.style.setProperty("--r", `${Math.round(Math.random() * 900 - 450)}deg`);
    piece.style.setProperty("--delay", "0ms");
    piece.style.setProperty("--color", colors[Math.floor(Math.random() * colors.length)]);
    piece.style.setProperty("--duration", `${duration}s`);
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), (duration + .5) * 1000);
  };
  celebration.hidden = false;
  clearTimeout(state.jackpotTimer);
  state.rainStartTimer = setTimeout(() => {
    const rainLoop = () => {
      if (celebration.hidden) return;
      for (let count = 0; count < 3; count += 1) spawnRainPiece();
      state.rainFrame = requestAnimationFrame(rainLoop);
    };
    state.rainFrame = requestAnimationFrame(rainLoop);
  }, 1000);
  state.jackpotTimer = setTimeout(() => {
    celebration.hidden = true;
    clearTimeout(state.rainStartTimer);
    cancelAnimationFrame(state.rainFrame);
    state.rainFrame = null;
  }, 5200);
}

function playGame() {
  if (state.gameBusy) return;
  const game = state.currentGame;
  if (game !== "tickets" && state.gameChanceUsed[game]) return;
  if (game === "tickets" && state.ticketSpinCount >= TICKET_MAX_CHANCES) return;
  if (game === "claw") {
    dropClaw();
    return;
  }
  state.gameBusy = true;
  if (game !== "tickets") state.gameChanceUsed[game] = true;
  const action = $("#gameAction");
  action.disabled = true;
  action.style.opacity = ".6";
  if (game === "wheel") {
    const wheel = $(".game-wheel");
    wheel.style.transform = `rotate(${1440 + Math.floor(Math.random() * 360)}deg)`;
  }
  const spinDuration = game === "tickets" ? spinTicketReels() : 2700;
  setTimeout(() => {
    const options = REWARDS[game];
    const jackpot = game === "tickets" && state.ticketJackpot;
    const reward = jackpot ? "1000 tickets" : options[Math.floor(Math.random() * options.length)];
    applyReward(reward);
    $("#resultText").textContent = reward;
    $("#gameResult").hidden = false;
    const chancesLeft = TICKET_MAX_CHANCES - state.ticketSpinCount;
    action.innerHTML = game === "tickets" && chancesLeft > 0 ? `Spin again <span>↻</span>` : 'Chances used <span>✓</span>';
    action.disabled = game === "tickets" ? chancesLeft === 0 : true;
    action.style.opacity = game === "tickets" && chancesLeft > 0 ? "1" : ".55";
    if (jackpot) showJackpotCelebration();
    state.gameBusy = false;
    state.ticketJackpot = false;
  }, spinDuration);
}

function applyReward(reward) {
  const number = parseInt(reward, 10) || 0;
  if (reward.includes("gem")) state.gems += number;
  if (reward.includes("ticket")) state.tickets += number;
  if (reward.includes("break")) state.breaks += number;
  state.playCompleted = true;
  updateStats();
  showToast(`${reward} added to your stash`);
}

function showToast(message) {
  $("#toastText").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => $("#toast").classList.remove("show"), 2600);
}

function closeModal(type) {
  if (type === "task") { clearInterval(state.timerInterval); $("#taskOverlay").hidden = true; }
  if (type === "reward") $("#rewardOverlay").hidden = true;
  if (type === "daily") $("#dailyRewardOverlay").hidden = true;
  if (type === "break") { clearInterval(state.breakInterval); state.breakInterval = null; $("#breakOverlay").hidden = true; }
  if (type === "game") { clearTimeout(state.clawRaiseTimer); clearTimeout(state.clawRewardTimer); clearTimeout(state.jackpotTimer); clearTimeout(state.rainStartTimer); cancelAnimationFrame(state.rainFrame); state.rainFrame = null; $("#jackpotCelebration").hidden = true; $("#gameOverlay").hidden = true; state.gameBusy = false; }
}

function resetDemo() {
  clearInterval(state.breakInterval);
  state.breakInterval = null;
  state.tasks = structuredClone(DEFAULT_TASKS); state.gems = 25; state.tickets = 12; state.breaks = 0; state.currentTask = null; state.playCompleted = false; state.clawChanceUsed = false; state.gameChanceUsed = { claw: false, wheel: false, tickets: false }; state.ticketJackpot = false; state.ticketSpinCount = 0; state.dailyReward = { lastClaimed: "", streak: 0 };
  saveDailyReward();
  ["taskOverlay", "rewardOverlay", "gameOverlay", "dailyRewardOverlay", "breakOverlay"].forEach((id) => $("#" + id).hidden = true);
  renderTasks(); renderDailyReward(); showView("focus"); showToast("Demo reset — your queue is ready");
}

$("#addTaskForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#taskInput");
  const title = input.value.trim();
  if (!title) return input.focus();
  state.tasks.push({ id: Date.now(), title, detail: "Fresh focus round", done: false });
  input.value = ""; $("#addTaskForm").hidden = true; renderTasks(); showToast("Task added to the queue");
});
$("#openAddTask").addEventListener("click", () => { $("#addTaskForm").hidden = false; $("#taskInput").focus(); });
$("#emptyAddTask").addEventListener("click", () => { $("#addTaskForm").hidden = false; $("#taskInput").focus(); });
$("#cancelAddTask").addEventListener("click", () => { $("#addTaskForm").hidden = true; });
$("#startNextTask").addEventListener("click", () => openTask(state.tasks.find((task) => !task.done)));
$("#doneTask").addEventListener("click", askIfDone);
$("#notDone").addEventListener("click", returnToTimer);
$("#confirmDone").addEventListener("click", confirmTaskDone);
$("#toArcade").addEventListener("click", goToArcade);
$("#gameAction").addEventListener("click", playGame);
$("#backToTasks").addEventListener("click", () => { closeModal("game"); showView("focus"); });
$("#claimDailyReward").addEventListener("click", claimDailyReward);
$("#breakCount").addEventListener("click", openBreakModal);
$("#startBreak").addEventListener("click", startBreak);
$("#finishBreak").addEventListener("click", finishBreak);
$("#extraBreakButton").addEventListener("click", toggleExtraBreakOptions);
$("#extraBreakOptions").addEventListener("click", (event) => {
  const option = event.target.closest("[data-break-minutes]");
  if (option) buyExtraBreak(Number(option.dataset.breakMinutes), Number(option.dataset.breakCost));
});
$("#resetDemo").addEventListener("click", resetDemo);

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) showView(viewButton.dataset.view);
  const gameButton = event.target.closest("[data-game]");
  if (gameButton) openGame(gameButton.dataset.game);
  const closeButton = event.target.closest("[data-close]");
  if (closeButton) closeModal(closeButton.dataset.close);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") ["task", "reward", "game", "daily", "break"].forEach(closeModal);
  handleClawKeydown(event);
});

const today = new Date();
$("#sessionDate").textContent = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
Object.assign(state, loadProgress());
state.dailyReward = loadDailyReward();
renderTasks();
renderDailyReward();
openDailyReward();
