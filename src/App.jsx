import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Zap, Users, Trophy, Copy, ArrowRight, Crown, Radio, RotateCcw, Wifi, WifiOff, Sparkles } from "lucide-react";
import { QUESTIONS } from "./questions";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const ROUND_SECONDS = 15;
const MAX_PLAYERS = 10;
const letters = ["A", "B", "C", "D"];

function makeCode() {
  return Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
}
function randomQuestions() {
  return [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 5);
}
function cleanName(name) {
  return name.trim().replace(/\s+/g, " ").slice(0, 18);
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [name, setName] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState("offline");
  const [notice, setNotice] = useState("");
  const channelRef = useRef(null);
  const playerIdRef = useRef(crypto.randomUUID());
  const gameRef = useRef(game);
  const playersRef = useRef(players);
  const isHostRef = useRef(isHost);
  const roomRef = useRef(roomCode);
  const nameRef = useRef("");
  const roundTimerRef = useRef(null);
  const advanceTimerRef = useRef(null);
  const hostClockRef = useRef(null);
  const joinedRef = useRef(false);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { roomRef.current = roomCode; }, [roomCode]);

  const broadcast = useCallback(async (event, payload) => {
    if (!channelRef.current) return;
    await channelRef.current.send({ type: "broadcast", event, payload });
  }, []);

  const publishGame = useCallback(async (nextGame) => {
    const previous = gameRef.current;
    if (nextGame?.roundIndex !== previous?.roundIndex || nextGame?.status === "finished") setSelected(null);
    gameRef.current = nextGame;
    setGame(nextGame);
    await broadcast("game_state", nextGame);
  }, [broadcast]);

  const publishPlayers = useCallback(async (nextPlayers) => {
    playersRef.current = nextPlayers;
    setPlayers(nextPlayers);
    await broadcast("players_state", nextPlayers);
  }, [broadcast]);

  const stopTimers = useCallback(() => {
    clearInterval(roundTimerRef.current);
    clearTimeout(advanceTimerRef.current);
    clearInterval(hostClockRef.current);
  }, []);

  const leaveRoom = useCallback(async () => {
    stopTimers();
    if (channelRef.current) {
      await channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    joinedRef.current = false;
    setConnection("offline");
    setGame(null);
    setPlayers([]);
    setRoomCode("");
    setIsHost(false);
    setSelected(null);
    setScreen("home");
  }, [stopTimers]);

  useEffect(() => () => {
    stopTimers();
    if (channelRef.current) channelRef.current.unsubscribe();
  }, [stopTimers]);

  const startHostClock = useCallback(() => {
    clearInterval(hostClockRef.current);
    hostClockRef.current = setInterval(() => {
      const current = gameRef.current;
      if (!isHostRef.current || !current || current.status !== "playing") return;
      if (current.deadline && Date.now() >= current.deadline) {
        clearInterval(hostClockRef.current);
        const revealed = { ...current, status: "reveal" };
        publishGame(revealed);
        advanceTimerRef.current = setTimeout(() => {
          const latest = gameRef.current;
          if (!isHostRef.current || !latest) return;
          if (latest.roundIndex + 1 >= latest.questions.length) {
            publishGame({ ...latest, status: "finished" });
          } else {
            publishGame({ ...latest, status: "playing", roundIndex: latest.roundIndex + 1, deadline: Date.now() + ROUND_SECONDS * 1000, answers: {} });
            startHostClock();
          }
        }, 2600);
      } else if (current.deadline) {
        setSecondsLeft(Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)));
      }
    }, 200);
  }, [publishGame]);

  const handleAnswer = useCallback(async ({ playerId, answer, roundIndex }) => {
    if (!isHostRef.current) return;
    const current = gameRef.current;
    if (!current || current.status !== "playing" || current.roundIndex !== roundIndex || Date.now() > current.deadline) return;
    if (current.answers?.[playerId] !== undefined) return;
    const question = current.questions[current.roundIndex];
    const correct = answer === question.correct;
    const timeBonus = Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)) * 10;
    const points = correct ? 500 + timeBonus : 0;
    const nextAnswers = { ...current.answers, [playerId]: { answer, correct, points } };
    const nextPlayers = playersRef.current.map(p => p.id === playerId ? { ...p, score: (p.score || 0) + points } : p);
    await publishPlayers(nextPlayers);
    await publishGame({ ...current, answers: nextAnswers });
    if (Object.keys(nextAnswers).length >= nextPlayers.length) {
      clearInterval(hostClockRef.current);
      const latest = { ...gameRef.current, status: "reveal" };
      await publishGame(latest);
      advanceTimerRef.current = setTimeout(() => {
        const now = gameRef.current;
        if (!isHostRef.current || !now) return;
        if (now.roundIndex + 1 >= now.questions.length) publishGame({ ...now, status: "finished" });
        else {
          publishGame({ ...now, status: "playing", roundIndex: now.roundIndex + 1, deadline: Date.now() + ROUND_SECONDS * 1000, answers: {} });
          startHostClock();
        }
      }, 2600);
    }
  }, [publishGame, publishPlayers, startHostClock]);

  const connectRoom = useCallback(async ({ code, playerName, host }) => {
    if (!supabase) {
      setNotice("Connect Supabase first. Follow the SETUP.md file included with this project.");
      return;
    }
    const safeName = cleanName(playerName);
    if (!safeName) { setNotice("Enter your nickname first."); return; }
    stopTimers();
    if (channelRef.current) await channelRef.current.unsubscribe();
    const normalizedCode = code.toUpperCase().trim();
    const channel = supabase.channel(`party-clash-${normalizedCode}`, {
      config: { broadcast: { self: false }, presence: { key: playerIdRef.current } }
    });
    channelRef.current = channel;
    nameRef.current = safeName;
    setNotice("");
    setRoomCode(normalizedCode);
    setIsHost(host);
    isHostRef.current = host;
    setSelected(null);
    setScreen("room");
    setConnection("connecting");

    channel.on("broadcast", { event: "game_state" }, ({ payload }) => {
      if (!isHostRef.current) {
        if (payload?.roundIndex !== gameRef.current?.roundIndex || payload?.status === "playing") setSelected(null);
        gameRef.current = payload;
        setGame(payload);
        if (payload?.deadline && payload.status === "playing") setSecondsLeft(Math.max(0, Math.ceil((payload.deadline - Date.now()) / 1000)));
      }
    }).on("broadcast", { event: "players_state" }, ({ payload }) => {
      playersRef.current = payload;
      setPlayers(payload);
    }).on("broadcast", { event: "state_request" }, async () => {
      if (isHostRef.current) {
        if (gameRef.current) await broadcast("game_state", gameRef.current);
        await broadcast("players_state", playersRef.current);
      }
    }).on("broadcast", { event: "answer" }, ({ payload }) => {
      handleAnswer(payload);
    }).on("broadcast", { event: "start_game" }, async () => {
      if (isHostRef.current) return;
      setSelected(null);
    }).on("presence", { event: "sync" }, async () => {
      const state = channel.presenceState();
      const active = Object.values(state).flat().map(meta => ({
        id: meta.playerId, name: meta.name, isHost: meta.isHost, score: meta.score || 0
      }));
      const unique = [...new Map(active.map(p => [p.id, p])).values()];
      if (isHostRef.current) {
        const old = playersRef.current;
        const merged = unique.map(p => {
          const prior = old.find(x => x.id === p.id);
          return { ...p, score: prior?.score || p.score || 0 };
        });
        await publishPlayers(merged);
      } else {
        setPlayers(unique);
      }
    });

    channel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        setConnection("online");
        joinedRef.current = true;
        const currentPlayers = playersRef.current;
        if (host) {
          const initialPlayers = [{ id: playerIdRef.current, name: safeName, isHost: true, score: 0 }];
          await channel.track({ playerId: playerIdRef.current, name: safeName, isHost: true, score: 0 });
          await publishPlayers(initialPlayers);
          await publishGame({ status: "waiting", roundIndex: 0, questions: [], answers: {} });
        } else {
          const presence = channel.presenceState();
          const count = Object.values(presence).flat().length;
          if (count >= MAX_PLAYERS) {
            setNotice("This room is full (10 players maximum).");
            await channel.unsubscribe();
            setScreen("home");
            return;
          }
          await channel.track({ playerId: playerIdRef.current, name: safeName, isHost: false, score: 0 });
          await broadcast("state_request", {});
          setTimeout(() => broadcast("state_request", {}), 700);
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnection("offline");
        setNotice("Could not connect to the room. Check your Supabase settings and try again.");
      }
    });
  }, [broadcast, handleAnswer, publishGame, publishPlayers, stopTimers]);

  const createRoom = () => connectRoom({ code: makeCode(), playerName: name, host: true });
  const joinRoom = () => {
    if (!roomInput.trim()) { setNotice("Enter a room code."); return; }
    connectRoom({ code: roomInput, playerName: name, host: false });
  };

  const startGame = async () => {
    if (!isHostRef.current) return;
    if (playersRef.current.length < 2) { setNotice("Invite at least one friend before starting."); return; }
    const resetPlayers = playersRef.current.map(p => ({ ...p, score: 0 }));
    await publishPlayers(resetPlayers);
    const nextGame = { status: "playing", questions: randomQuestions(), roundIndex: 0, deadline: Date.now() + ROUND_SECONDS * 1000, answers: {} };
    setNotice("");
    setSelected(null);
    await publishGame(nextGame);
    await broadcast("start_game", {});
    startHostClock();
  };

  const submitAnswer = async (answerIndex) => {
    const current = gameRef.current;
    if (!current || current.status !== "playing" || selected !== null || current.answers?.[playerIdRef.current] !== undefined) return;
    setSelected(answerIndex);
    const payload = { playerId: playerIdRef.current, answer: answerIndex, roundIndex: current.roundIndex };
    if (isHostRef.current) await handleAnswer(payload);
    else await broadcast("answer", payload);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setNotice(`Share this room code: ${roomCode}`); }
  };

  useEffect(() => {
    const current = game;
    if (current?.status === "playing" && current.deadline) setSecondsLeft(Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)));
    else if (current?.status === "waiting") setSecondsLeft(ROUND_SECONDS);
  }, [game?.status, game?.roundIndex, game?.deadline]);

  const currentQuestion = game?.questions?.[game.roundIndex];
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => (b.score || 0) - (a.score || 0)), [players]);
  const myAnswer = game?.answers?.[playerIdRef.current];
  const answeredCount = Object.keys(game?.answers || {}).length;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <button className="brand" onClick={() => screen === "home" ? null : leaveRoom()} aria-label="Party Clash home">
          <span className="brand-mark"><Zap size={20} fill="currentColor" /></span>
          <span>PARTY<span className="brand-accent">CLASH</span></span>
        </button>
        <div className={`connection ${connection}`}><span className="connection-dot" />{connection === "online" ? "LIVE ROOM" : connection === "connecting" ? "CONNECTING" : "NEON ARCADE"}</div>
      </header>

      {screen === "home" && <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> THE ULTIMATE GAME NIGHT</div>
          <h1>Brains on.<br /><span>Game face.</span></h1>
          <p className="hero-description">Challenge your crew in a real-time trivia showdown. Quick answers, big points, bragging rights.</p>
          <div className="feature-row"><span><Users size={16}/> 2–10 PLAYERS</span><span><Radio size={16}/> REAL-TIME</span><span><Trophy size={16}/> 5 ROUNDS</span></div>
        </div>
        <div className="lobby-card">
          <div className="card-topline"><span className="live-pulse" /> READY PLAYER ONE?</div>
          <label htmlFor="nickname">YOUR NICKNAME</label>
          <input id="nickname" value={name} onChange={e => setName(e.target.value)} maxLength={18} placeholder="e.g. Quiz Wizard" onKeyDown={e => e.key === "Enter" && createRoom()} />
          <button className="primary-button" onClick={createRoom}>Create a room <ArrowRight size={18}/></button>
          <div className="or-divider"><span /> OR JOIN YOUR FRIENDS <span /></div>
          <label htmlFor="roomcode">ROOM CODE</label>
          <div className="join-row"><input id="roomcode" value={roomInput} onChange={e => setRoomInput(e.target.value.toUpperCase().slice(0, 5))} placeholder="ABCDE" maxLength={5} onKeyDown={e => e.key === "Enter" && joinRoom()} /><button className="join-button" onClick={joinRoom}>Join</button></div>
          {notice && <p className="notice">{notice}</p>}
          {!supabase && <p className="setup-hint">Setup needed: add your Supabase keys to <code>.env</code>.</p>}
        </div>
        <div className="hero-stats"><div><strong>15<span>s</span></strong><small>PER QUESTION</small></div><div><strong>500<span>+</span></strong><small>POINTS TO WIN</small></div><div><strong>1</strong><small>ULTIMATE CHAMPION</small></div></div>
      </section>}

      {screen === "room" && <section className="game-layout">
        <div className="game-main">
          <div className="room-heading">
            <div><div className="eyebrow"><span className="live-pulse" /> PRIVATE GAME ROOM</div><h2>{game?.status === "playing" ? "Lock in your answer." : game?.status === "reveal" ? "Here's the answer!" : game?.status === "finished" ? "Game over!" : "The crew is assembling."}</h2></div>
            <button className="code-chip" onClick={copyCode}><span>ROOM CODE</span><strong>{roomCode}</strong><Copy size={15}/>{copied && <em>Copied!</em>}</button>
          </div>

          {!game && <div className="waiting-panel">
            <div className="waiting-icon"><Users size={34}/></div><h3>Waiting for the host</h3><p>The host is getting the game ready. Share the room code with your friends.</p>
            <div className="waiting-code">{roomCode}</div>
          </div>}

          {game?.status === "waiting" && <div className="waiting-panel"><div className="waiting-icon"><Users size={34}/></div><h3>Ready when you are</h3><p>Get at least two players in the room, then the host can start the showdown.</p>{isHost && <button className="primary-button compact" onClick={startGame}>Start game <ArrowRight size={18}/></button>}</div>}

          {game?.status === "playing" && currentQuestion && <div className="question-card">
            <div className="question-meta"><span className="category-pill">{currentQuestion.category}</span><span>ROUND {game.roundIndex + 1} <i>/ {game.questions.length}</i></span></div>
            <div className="progress-track"><div style={{ width: `${((game.roundIndex + 1) / game.questions.length) * 100}%` }}/></div>
            <div className={`timer ${secondsLeft <= 5 ? "urgent" : ""}`}><span>{secondsLeft}</span><small>SECONDS</small></div>
            <h3>{currentQuestion.question}</h3>
            <div className="answer-grid">{currentQuestion.answers.map((answer, i) => {
              const isSelected = selected === i || myAnswer?.answer === i;
              return <button key={answer} className={`answer-option ${isSelected ? "chosen" : ""} ${myAnswer && isSelected ? (myAnswer.correct ? "correct" : "incorrect") : ""}`} onClick={() => submitAnswer(i)} disabled={selected !== null || !!myAnswer}>
                <span className="answer-letter">{letters[i]}</span><span>{answer}</span>
              </button>;
            })}</div>
            <div className="question-footer"><span>{answeredCount} of {players.length} answered</span><span>{selected !== null || myAnswer ? "ANSWER LOCKED IN" : "CHOOSE QUICKLY"}</span></div>
          </div>}

          {game?.status === "reveal" && currentQuestion && <div className="reveal-card"><div className="reveal-burst"><Trophy size={28}/></div><div className="eyebrow">ROUND {game.roundIndex + 1} RECAP</div><h3>{currentQuestion.question}</h3><div className="correct-answer"><span className="answer-letter">{letters[currentQuestion.correct]}</span>{currentQuestion.answers[currentQuestion.correct]}</div><p>Correct answers earn 500 points plus a speed bonus.</p><div className="mini-scores">{sortedPlayers.map((p, i) => <div key={p.id}><span>{i + 1}. {p.name}</span><strong>{p.score || 0} pts</strong></div>)}</div>{isHost && <button className="primary-button compact" onClick={() => {
            clearTimeout(advanceTimerRef.current);
            const now = gameRef.current;
            if (now.roundIndex + 1 >= now.questions.length) publishGame({ ...now, status: "finished" });
            else { publishGame({ ...now, status: "playing", roundIndex: now.roundIndex + 1, deadline: Date.now() + ROUND_SECONDS * 1000, answers: {} }); setSelected(null); startHostClock(); }
          }}>{game.roundIndex + 1 >= game.questions.length ? "See final results" : "Next round"} <ArrowRight size={18}/></button>}</div>}

          {game?.status === "finished" && <div className="finished-card"><div className="winner-crown"><Crown size={34} fill="currentColor"/></div><div className="eyebrow">FINAL STANDINGS</div><h2>{sortedPlayers[0]?.name || "The crew"} wins!</h2><p>Well played. The group chat will hear about this.</p><div className="final-leaderboard">{sortedPlayers.map((p, i) => <div className={`leader-row ${i === 0 ? "winner" : ""}`} key={p.id}><span className="rank">{i === 0 ? <Crown size={17}/> : `0${i + 1}`}</span><span className="leader-name">{p.name}{p.id === playerIdRef.current ? " (you)" : ""}</span><strong>{p.score || 0}<small> PTS</small></strong></div>)}</div>{isHost && <button className="primary-button compact" onClick={startGame}><RotateCcw size={17}/> Play again</button>}<button className="text-button" onClick={leaveRoom}>Leave room</button></div>}
        </div>

        <aside className="sidebar">
          <div className="sidebar-title"><div><Users size={17}/> PLAYERS <span>{players.length}/{MAX_PLAYERS}</span></div><span className="live-tag">LIVE</span></div>
          <div className="player-list">{sortedPlayers.map((p, i) => <div className={`player-item ${p.id === playerIdRef.current ? "me" : ""}`} key={p.id}><div className={`avatar avatar-${i % 5}`}>{p.name.slice(0, 1).toUpperCase()}</div><div className="player-info"><strong>{p.name}{p.id === playerIdRef.current && <small> YOU</small>}</strong><span>{p.isHost ? "HOST" : "PLAYER"}</span></div>{p.isHost && <Crown size={15} className="host-crown"/>}<b>{p.score || 0}</b></div>)}
            {Array.from({ length: Math.max(0, 2 - players.length) }).map((_, i) => <div className="player-item ghost" key={i}><div className="avatar"><Users size={15}/></div><div className="player-info"><strong>Open spot</strong><span>INVITE A FRIEND</span></div></div>)}
          </div>
          <div className="invite-card"><div className="invite-icon"><Zap size={17}/></div><strong>More players, more chaos.</strong><p>Send your friends the room code to bring them into the game.</p><button onClick={copyCode}>{copied ? "CODE COPIED!" : "COPY ROOM CODE"} <Copy size={14}/></button></div>
          <div className="rules-card"><strong>HOW TO PLAY</strong><p><span>01</span> Answer before time runs out.</p><p><span>02</span> Correct answers earn 500 points.</p><p><span>03</span> Answer faster for bonus points.</p></div>
          {notice && <p className="notice">{notice}</p>}
          <button className="leave-button" onClick={leaveRoom}>Leave room</button>
        </aside>
      </section>}

      <footer className="footer"><span>PARTY CLASH <i>©</i> 2026</span><span>MADE FOR YOUR NEXT GAME NIGHT <Zap size={12} fill="currentColor"/></span></footer>
    </main>
  );
}
