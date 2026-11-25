function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, "0")}`;
}

function showFeedback(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = `feedback show ${type}`;
}

async function postJSON(url, body = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

// Join page
const joinForm = document.getElementById("join-form");
if (joinForm) {
  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("player-name");
    const fb = document.getElementById("join-feedback");
    const btn = joinForm.querySelector("button");
    btn.disabled = true;
    const res = await postJSON("/api/join", { name: nameInput.value });
    btn.disabled = false;
    if (res.ok) {
      window.location.href = "/lobby";
    } else {
      showFeedback(fb, res.data.error || "Unable to join", "error");
    }
  });
}

// Lobby page polling
const lobbyRoot = document.getElementById("lobby-root");
if (lobbyRoot) {
  const countEl = document.getElementById("lobby-count");
  const listEl = document.getElementById("lobby-players");

  async function pollLobby() {
    try {
      const res = await fetch("/api/lobby");
      const data = await res.json();
      if (!data.me_exists) {
        window.location.href = "/";
        return;
      }
      if (data.status === "running") {
        window.location.href = "/level";
        return;
      }
      if (data.status === "finished") {
        window.location.href = "/leaderboard";
        return;
      }
      countEl.textContent = `${data.player_count} / ${data.max_players} players joined`;
      listEl.innerHTML = data.players.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
    } catch (_) {}
  }

  pollLobby();
  setInterval(pollLobby, 2500);
}

// Level page
const submitForm = document.getElementById("submit-form");
if (submitForm) {
  const answerInput = document.getElementById("answer-input");
  const fb = document.getElementById("submit-feedback");
  const hintBtn = document.getElementById("hint-btn");
  const hintBox = document.getElementById("hint-box");
  const hintsUsedEl = document.getElementById("hints-used");

  submitForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = submitForm.querySelector("button[type='submit']");
    btn.disabled = true;
    const res = await postJSON("/api/submit", { answer: answerInput.value });
    btn.disabled = false;

    if (!res.ok) {
      showFeedback(fb, res.data.error || "Error submitting answer", "error");
      return;
    }
    if (!res.data.correct) {
      showFeedback(fb, res.data.message || "Wrong, try again.", "error");
      answerInput.select();
      return;
    }
    showFeedback(fb, "Correct! Advancing...", "success");
    setTimeout(() => {
      window.location.href = res.data.finished ? "/leaderboard" : "/level";
    }, 450);
  });

  if (hintBtn) {
    hintBtn.addEventListener("click", async () => {
      hintBtn.disabled = true;
      const res = await postJSON("/api/hint");
      hintBtn.disabled = false;
      if (res.ok) {
        showFeedback(hintBox, `Hint: ${res.data.hint}`, "hint");
        if (hintsUsedEl) hintsUsedEl.textContent = `Hints: ${res.data.hints_used}`;
      }
    });
  }
}

// Leaderboard page (10s auto-refresh)
const lbBody = document.getElementById("leaderboard-body");
if (lbBody) {
  const statusBadge = document.getElementById("lb-status");
  const updatedEl = document.getElementById("lb-updated");

  async function refreshLeaderboard() {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      if (statusBadge) {
        statusBadge.textContent = data.status.toUpperCase();
        statusBadge.className = `badge ${data.status}`;
      }
      if (data.players.length === 0) {
        lbBody.innerHTML = `<tr><td colspan="5" class="muted">No players yet.</td></tr>`;
      } else {
        lbBody.innerHTML = data.players
          .map((p) => {
            const prog = p.finished ? "FINISHED" : `Level ${p.current_level} / ${data.total_levels}`;
            return `<tr class="${p.rank <= 3 ? "top-rank" : ""}">
              <td>#${p.rank}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${prog}</td>
              <td>${formatDuration(p.elapsed_seconds)}</td>
              <td>${p.hints_used}</td>
            </tr>`;
          })
          .join("");
      }
      if (updatedEl) {
        updatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      }
    } catch (_) {}
  }

  refreshLeaderboard();
  setInterval(refreshLeaderboard, 10000);
}

// Admin page
const adminLoginForm = document.getElementById("admin-login-form");
if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("admin-password").value;
    const fb = document.getElementById("admin-login-feedback");
    const res = await postJSON("/admin/login", { password: pw });
    if (res.ok) {
      window.location.reload();
    } else {
      showFeedback(fb, res.data.error || "Login failed", "error");
    }
  });
}

const adminDashboard = document.getElementById("admin-dashboard");
if (adminDashboard) {
  const statusEl = document.getElementById("admin-status-badge");
  const countEl = document.getElementById("admin-player-count");
  const tbody = document.getElementById("admin-players-body");
  const fb = document.getElementById("admin-feedback");

  async function refreshAdmin() {
    try {
      const res = await fetch("/api/admin/status");
      if (res.status === 403) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      statusEl.textContent = data.status.toUpperCase();
      statusEl.className = `badge ${data.status}`;
      countEl.textContent = `${data.players.length} / ${data.max_players} players (min ${data.min_players} to start)`;

      if (data.players.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="muted">Waiting for players to join...</td></tr>`;
      } else {
        tbody.innerHTML = data.players
          .map((p) => {
            const prog = p.finished ? "FINISHED" : `L${p.current_level}/${data.total_levels}`;
            return `<tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${prog}</td>
              <td>${formatDuration(p.elapsed_seconds)}</td>
              <td>${p.attempts}</td>
              <td>${p.hints_used}</td>
              <td><button class="danger small" onclick="kickPlayer(${p.id})">Kick</button></td>
            </tr>`;
          })
          .join("");
      }
    } catch (_) {}
  }

  window.kickPlayer = async (id) => {
    const res = await postJSON("/admin/kick", { player_id: id });
    if (res.ok) {
      showFeedback(fb, "Player kicked.", "success");
      refreshAdmin();
    }
  };

  document.getElementById("btn-start").addEventListener("click", async () => {
    const res = await postJSON("/admin/start");
    if (res.ok) {
      showFeedback(fb, "Game started!", "success");
      refreshAdmin();
    } else {
      showFeedback(fb, res.data.error || "Cannot start", "error");
    }
  });

  document.getElementById("btn-finish").addEventListener("click", async () => {
    const res = await postJSON("/admin/finish");
    if (res.ok) {
      showFeedback(fb, "Game marked finished.", "success");
      refreshAdmin();
    }
  });

  document.getElementById("btn-reset").addEventListener("click", async () => {
    if (!confirm("Reset all players, submissions, and return to lobby?")) return;
    const res = await postJSON("/admin/reset");
    if (res.ok) {
      showFeedback(fb, "Game reset to lobby.", "success");
      refreshAdmin();
    }
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await postJSON("/admin/logout");
    window.location.reload();
  });

  refreshAdmin();
  setInterval(refreshAdmin, 3000);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

