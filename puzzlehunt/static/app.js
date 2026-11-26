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
    try {
      const res = await postJSON("/api/join", { name: nameInput.value });
      if (res.ok) {
        window.location.href = "/lobby";
      } else {
        showFeedback(fb, res.data.error || "Unable to join. Please try again.", "error");
        nameInput.focus();
      }
    } catch (_) {
      showFeedback(fb, "Couldn't reach the hunt. Check your connection and try again.", "error");
    } finally {
      btn.disabled = false;
    }
  });
}

// Lobby page polling
const lobbyRoot = document.getElementById("lobby-root");
if (lobbyRoot) {
  const countEl = document.getElementById("lobby-count");
  const listEl = document.getElementById("lobby-players");
  const feedbackEl = document.getElementById("lobby-feedback");

  async function pollLobby() {
    try {
      const res = await fetch("/api/lobby");
      if (!res.ok) throw new Error("Lobby status unavailable");
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
      countEl.textContent = `${data.player_count} / ${data.max_players} players`;
      listEl.innerHTML = data.players.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
      feedbackEl.className = "feedback";
    } catch (_) {
      showFeedback(feedbackEl, "Having trouble refreshing the lobby. We’ll keep trying.", "error");
    }
  }

  pollLobby();
  setInterval(pollLobby, 2500);
}

// Level page
const submitForm = document.getElementById("submit-form");
if (submitForm) {
  const answerInput = document.getElementById("answer-input");
  const submitButton = submitForm.querySelector("button[type='submit']");
  const fb = document.getElementById("submit-feedback");
  const hintBtn = document.getElementById("hint-btn");
  const hintBox = document.getElementById("hint-box");
  const hintsUsedEl = document.getElementById("hints-used");
  const submissionPausedEl = document.getElementById("submission-paused");
  const hintPausedEl = document.getElementById("hint-paused");
  let submissionPending = false;
  let hintPending = false;

  async function refreshPlayerControls() {
    try {
      const res = await fetch("/api/leaderboard");
      if (!res.ok) return;
      const data = await res.json();
      answerInput.disabled = !data.submissions_enabled;
      submitButton.disabled = submissionPending || !data.submissions_enabled;
      hintBtn.disabled = hintPending || !data.hints_enabled;
      submissionPausedEl.hidden = data.submissions_enabled;
      hintPausedEl.hidden = data.hints_enabled;
    } catch (_) {}
  }
  refreshPlayerControls();
  setInterval(refreshPlayerControls, 3000);

  submitForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    submissionPending = true;
    submitButton.disabled = true;
    let res;
    try {
      res = await postJSON("/api/submit", { answer: answerInput.value });
    } catch (_) {
      submissionPending = false;
      showFeedback(fb, "Couldn't send your answer. Check your connection and try again.", "error");
      refreshPlayerControls();
      return;
    }
    submissionPending = false;
    refreshPlayerControls();

    if (!res.ok) {
      const message = res.status === 429
        ? "One moment! Give it a second before trying again."
        : (res.data.error || "Couldn't check that answer. Please try again.");
      showFeedback(fb, message, "error");
      return;
    }
    if (!res.data.correct) {
      showFeedback(fb, "Not quite — give it another look. You’ve got this!", "error");
      answerInput.select();
      return;
    }
    showFeedback(fb, res.data.finished ? "Brilliant! You solved the final puzzle. 🎉" : "That’s it! Next puzzle coming up… ✨", "success");
    setTimeout(() => {
      window.location.href = res.data.finished ? "/leaderboard" : "/level";
    }, 450);
  });

  if (hintBtn) {
    hintBtn.addEventListener("click", async () => {
      hintPending = true;
      hintBtn.disabled = true;
      try {
        const res = await postJSON("/api/hint");
        if (res.ok) {
          showFeedback(hintBox, `💡 Hint: ${res.data.hint}`, "hint");
          if (hintsUsedEl) hintsUsedEl.textContent = `💡 Hints: ${res.data.hints_used}`;
        } else {
          showFeedback(hintBox, res.data.error || "Couldn't load a hint. Try again.", "error");
        }
      } catch (_) {
        showFeedback(hintBox, "Couldn't reach the hint service. Check your connection and try again.", "error");
      } finally {
        hintPending = false;
        refreshPlayerControls();
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
      if (!res.ok) throw new Error("Leaderboard unavailable");
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
    } catch (_) {
      if (updatedEl) updatedEl.textContent = "Couldn’t refresh — retrying…";
    }
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
      document.getElementById("btn-toggle-hints").textContent = data.hints_enabled ? "Pause hints" : "Resume hints";
      document.getElementById("btn-toggle-submissions").textContent = data.submissions_enabled ? "Pause submissions" : "Resume submissions";

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

  document.getElementById("btn-toggle-hints").addEventListener("click", async (event) => {
    const enabled = event.currentTarget.textContent === "Resume hints";
    const res = await postJSON("/admin/settings", { hints_enabled: enabled });
    if (res.ok) {
      showFeedback(fb, enabled ? "Hints resumed." : "Hints paused.", "success");
      refreshAdmin();
    } else {
      showFeedback(fb, res.data.error || "Couldn't update hints.", "error");
    }
  });

  document.getElementById("btn-toggle-submissions").addEventListener("click", async (event) => {
    const enabled = event.currentTarget.textContent === "Resume submissions";
    const res = await postJSON("/admin/settings", { submissions_enabled: enabled });
    if (res.ok) {
      showFeedback(fb, enabled ? "Answer submissions resumed." : "Answer submissions paused.", "success");
      refreshAdmin();
    } else {
      showFeedback(fb, res.data.error || "Couldn't update submissions.", "error");
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

