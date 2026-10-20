
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const SALES_STATUSES = [
  "Converted",
  "Interested",
  "Follow-up Required",
  "Not Interested",
  "Demo Requested",
  "No Response",
];

const INITIAL_GREETING =
  "Hello! I'm the FlowDesk sales assistant. I'd love to learn a little about your workflow and see whether FlowDesk could help. What is your team currently using to manage its sales and customer relationships?";

function formatDuration(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function getStatusClass(status = "") {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function App() {
  const [callActive, setCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState("Ready to call");
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState([]);
  const [interimText, setInterimText] = useState("");
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [history, setHistory] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const transcriptRef = useRef([]);
  const startedAtRef = useRef(null);
  const endedAtRef = useRef(null);
  const callActiveRef = useRef(false);
  const processingRef = useRef(false);
  const savingRef = useRef(false);
  const greetingRef = useRef(false);
  const speechSupportedRef = useRef(false);
  const audioUrlRef = useRef("");
  const recordingConsentRef = useRef(false);
  const lastSpokenRef = useRef("");

  const updateTranscript = useCallback((messages) => {
    transcriptRef.current = messages;
    setTranscript([...messages]);
  }, []);

  const addMessage = useCallback(
    (role, content) => {
      const message = {
        role,
        content,
        timestamp: new Date().toISOString(),
      };

      updateTranscript([...transcriptRef.current, message]);
      return message;
    },
    [updateTranscript]
  );

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/calls`);

      if (!response.ok) {
        throw new Error("Could not load call history.");
      }

      const data = await response.json();
      setHistory(data);
    } catch (err) {
      setError(err.message || "Could not load call history.");
    }
  }, []);

  useEffect(() => {
    loadHistory();

    return () => {
      callActiveRef.current = false;

      if (recognitionRef.current) {
        try {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {}
      }

      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, [loadHistory]);

  useEffect(() => {
    if (!callActive) return;

    const interval = window.setInterval(() => {
      if (startedAtRef.current) {
        setDuration(
          Math.max(
            0,
            Math.floor((Date.now() - startedAtRef.current.getTime()) / 1000)
          )
        );
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [callActive]);

  const speak = useCallback((text) => {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      setCallStatus("Assistant speaking");
    };

    utterance.onend = () => {
      if (callActiveRef.current) {
        setCallStatus("Listening");
      }
    };

    utterance.onerror = () => {
      if (callActiveRef.current) {
        setCallStatus("Listening");
      }
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const getAIReply = useCallback(async (message) => {
    const messages = transcriptRef.current
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map(({ role, content }) => ({ role, content }));

    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        history: messages.slice(0, -1),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || "The AI could not respond.");
    }

    return result.reply;
  }, []);

  const setupRecognition = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      speechSupportedRef.current = false;
      return null;
    }

    speechSupportedRef.current = true;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = async (event) => {
      let finalText = "";
      let temporaryText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalText += `${text} `;
        } else {
          temporaryText += text;
        }
      }

      setInterimText(temporaryText);

      const cleanedText = finalText.trim();

      if (!cleanedText || !callActiveRef.current || processingRef.current) {
        return;
      }

      processingRef.current = true;
      setInterimText("");
      addMessage("user", cleanedText);
      setCallStatus("Generating response");

      try {
        const reply = await getAIReply(cleanedText);

        if (!callActiveRef.current) return;

        addMessage("assistant", reply);
        lastSpokenRef.current = reply;
        speak(reply);
      } catch (err) {
        if (callActiveRef.current) {
          setError(err.message || "Could not generate a response.");
          setCallStatus("Response error");
        }
      } finally {
        processingRef.current = false;

        if (callActiveRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {}
        }
      }
    };

    recognition.onerror = (event) => {
      if (!callActiveRef.current) return;

      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        setError("Microphone access was denied. Allow microphone access in your browser.");
        setCallStatus("Microphone permission required");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setCallStatus("Listening interrupted");
      }
    };

    recognition.onend = () => {
      if (
        callActiveRef.current &&
        !processingRef.current &&
        recognitionRef.current === recognition
      ) {
        try {
          recognition.start();
        } catch {}
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [addMessage, getAIReply, speak]);

  const startRecording = useCallback(async () => {
    if (!recordingConsentRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    mediaStreamRef.current = stream;
    audioChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onstart = () => {
      setRecordingActive(true);
    };

    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });

      if (blob.size > 0) {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
        }

        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        setRecordingUrl(url);
      }

      setRecordingActive(false);
      stream.getTracks().forEach((track) => track.stop());

      if (mediaStreamRef.current === stream) {
        mediaStreamRef.current = null;
      }
    };

    recorder.start();
  }, []);

  const startCall = useCallback(async () => {
    if (callActiveRef.current || busy) return;

    setError("");
    setNotice("");
    setSelectedCall(null);
    setRecordingUrl("");
    setDuration(0);
    setInterimText("");
    setCallStatus("Starting call");
    setBusy(true);
    setRecordingConsent(recordingConsentRef.current);

    updateTranscript([]);
    startedAtRef.current = new Date();
    endedAtRef.current = null;
    savingRef.current = false;
    greetingRef.current = false;
    processingRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support microphone access. Use a recent browser on localhost or HTTPS.");
      }

      const recognition = setupRecognition();

      if (!recognition) {
        throw new Error("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      }

      callActiveRef.current = true;
      setCallActive(true);

      if (recordingConsentRef.current) {
        try {
          await startRecording();
        } catch {
          setNotice("Recording could not start. The call can continue without a recording.");
        }
      }

      const greeting = INITIAL_GREETING;
      addMessage("assistant", greeting);
      greetingRef.current = true;
      speak(greeting);

      try {
        recognition.start();
        setCallStatus("Listening");
      } catch {
        setCallStatus("Ready to listen");
      }
    } catch (err) {
      callActiveRef.current = false;
      setCallActive(false);
      setError(err.message || "Could not start the call.");
      setCallStatus("Ready to call");
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    } finally {
      setBusy(false);
    }
  }, [addMessage, busy, setupRecognition, speak, startRecording, updateTranscript]);

  const saveCompletedCall = useCallback(async () => {
    if (savingRef.current || transcriptRef.current.length === 0) return;

    savingRef.current = true;
    setBusy(true);
    setCallStatus("Saving call");

    try {
      const formData = new FormData();

      formData.append("transcript", JSON.stringify(transcriptRef.current));
      formData.append("duration_seconds", String(duration));
      formData.append("consent", String(recordingConsentRef.current));

      if (recordingConsentRef.current && audioChunksRef.current.length > 0) {
        const blob = new Blob(audioChunksRef.current, {
          type: mediaRecorderRef.current?.mimeType || "audio/webm",
        });

        if (blob.size > 0) {
          formData.append("recording", blob, "sales-call.webm");
        }
      }

      const response = await fetch(`${API_URL}/api/calls`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not save this call.");
      }

      setSelectedCall({
        ...result,
        id: result.id,
        duration_seconds: duration,
        transcript: [...transcriptRef.current],
        consent: recordingConsentRef.current,
        has_recording: recordingConsentRef.current && audioChunksRef.current.length > 0,
        created_at: new Date().toISOString(),
      });

      setNotice("Call saved. AI analysis is ready.");
      setCallStatus("Call saved");
      await loadHistory();
    } catch (err) {
      setError(err.message || "Could not save the call.");
      setCallStatus("Call ended — save failed");
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  }, [duration, loadHistory]);

  const endCall = useCallback(() => {
    if (!callActiveRef.current) return;

    callActiveRef.current = false;
    setCallActive(false);
    setInterimText("");
    setCallStatus("Ending call");

    endedAtRef.current = new Date();

    if (startedAtRef.current) {
      setDuration(
        Math.max(
          0,
          Math.floor((endedAtRef.current - startedAtRef.current) / 1000)
        )
      );
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    }

    window.setTimeout(() => {
      saveCompletedCall();
    }, recorder && recorder.state !== "inactive" ? 500 : 0);
  }, [saveCompletedCall]);

  const openCall = useCallback(async (callId) => {
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_URL}/api/calls/${callId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not open this call.");
      }

      setSelectedCall(data);
      setTranscript(data.transcript || []);
    } catch (err) {
      setError(err.message || "Could not open this call.");
    }
  }, []);

  const playSavedRecording = useCallback((callId) => {
    const url = `${API_URL}/api/calls/${callId}/recording`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const downloadRecording = useCallback(() => {
    if (!recordingUrl) return;

    const link = document.createElement("a");
    link.href = recordingUrl;
    link.download = "flowdesk-sales-call.webm";
    link.click();
  }, [recordingUrl]);

  const changeConsent = (checked) => {
    recordingConsentRef.current = checked;
    setRecordingConsent(checked);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <h1>FlowDesk</h1>
            <span>AI SALES ASSISTANT</span>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <button
          className="nav-item active"
          onClick={() => {
            setSelectedCall(null);
            setError("");
            setNotice("");
          }}
        >
          <span className="nav-icon">◉</span>
          Live Sales Call
        </button>

        <button
          className="nav-item"
          onClick={() =>
            document.getElementById("call-history")?.scrollIntoView({
              behavior: "smooth",
            })
          }
        >
          <span className="nav-icon">◷</span>
          Call History
          <span className="nav-count">{history.length}</span>
        </button>

        <div className="sidebar-bottom">
          <div className="status-dot" />
          <div>
            <strong>Voice system</strong>
            <span>Browser-based audio</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">SALES WORKSPACE / OVERVIEW</div>
            <h2>AI Voice Sales Bot</h2>
            <p>Human-like conversations, actionable insights.</p>
          </div>

          <div className="topbar-right">
            <span className="system-pill">
              <span className="status-dot" />
              System ready
            </span>
            <div className="avatar">AI</div>
          </div>
        </header>

        {error && (
          <div className="alert error-alert" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="alert success-alert" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss notice">
              ×
            </button>
          </div>
        )}

        <section className="metrics-grid">
          <article className="metric-card">
            <div className="metric-icon purple">◉</div>
            <div className="metric-label">Total Calls</div>
            <div className="metric-value">{history.length}</div>
            <div className="metric-foot">Saved sales conversations</div>
          </article>

          <article className="metric-card">
            <div className="metric-icon green">✓</div>
            <div className="metric-label">Converted</div>
            <div className="metric-value">
              {history.filter((item) => item.sales_status === "Converted").length}
            </div>
            <div className="metric-foot">Marked as converted</div>
          </article>

          <article className="metric-card">
            <div className="metric-icon blue">↗</div>
            <div className="metric-label">Demo Requests</div>
            <div className="metric-value">
              {history.filter((item) => item.sales_status === "Demo Requested").length}
            </div>
            <div className="metric-foot">Interested in a demo</div>
          </article>

          <article className="metric-card">
            <div className="metric-icon orange">◷</div>
            <div className="metric-label">Follow-ups</div>
            <div className="metric-value">
              {history.filter((item) => item.sales_status === "Follow-up Required").length}
            </div>
            <div className="metric-foot">Need another touchpoint</div>
          </article>
        </section>

        <section className="workspace-grid">
          <article className="panel live-panel">
            <div className="panel-heading">
              <div>
                <div className="section-kicker">LIVE SESSION</div>
                <h3>Sales conversation</h3>
              </div>
              <span className={`call-state ${callActive ? "is-live" : ""}`}>
                <span className="status-dot" />
                {callActive ? "LIVE" : callStatus}
              </span>
            </div>

            <div className="voice-stage">
              <div className={`voice-orb ${callActive ? "voice-orb-live" : ""}`}>
                <div className="orb-inner">F</div>
                <span className="orb-ring ring-one" />
                <span className="orb-ring ring-two" />
              </div>

              <h3>{callActive ? "FlowDesk AI is on the call" : "Ready to connect"}</h3>
              <p>
                {callActive
                  ? "Speak naturally. The assistant will respond after you finish."
                  : "Start a call to begin your AI-powered sales conversation."}
              </p>

              <div className="call-timer">
                <span>◷</span>
                {formatDuration(duration)}
              </div>

              <div className="call-controls">
                {!callActive ? (
                  <button
                    className="primary-button"
                    onClick={startCall}
                    disabled={busy}
                  >
                    <span>▶</span>
                    {busy ? "Starting..." : "Start Call"}
                  </button>
                ) : (
                  <button className="end-button" onClick={endCall}>
                    <span>■</span>
                    End Call
                  </button>
                )}
              </div>

              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={recordingConsent}
                  onChange={(event) => changeConsent(event.target.checked)}
                  disabled={callActive || busy}
                />
                <span>
                  I consent to recording this call for playback and analysis.
                </span>
              </label>

              <div className="recording-indicator">
                <span className={`recording-dot ${recordingActive ? "recording-on" : ""}`} />
                {recordingActive ? "Microphone recording active" : "Recording is optional"}
              </div>

              {recordingUrl && (
                <div className="recording-actions">
                  <audio controls src={recordingUrl}>
                    Your browser does not support audio playback.
                  </audio>
                  <button className="secondary-button" onClick={downloadRecording}>
                    Download recording
                  </button>
                </div>
              )}
            </div>

            <div className="transcript-section">
              <div className="transcript-heading">
                <div>
                  <div className="section-kicker">CONVERSATION</div>
                  <h3>Live transcript</h3>
                </div>
                <span className="transcript-count">{transcript.length} messages</span>
              </div>

              <div className="transcript-list">
                {transcript.length === 0 && !interimText && (
                  <div className="empty-state">
                    <div className="empty-icon">▤</div>
                    <strong>No conversation yet</strong>
                    <p>Your conversation transcript will appear here.</p>
                  </div>
                )}

                {transcript.map((message, index) => (
                  <div
                    className={`transcript-message ${
                      message.role === "assistant" ? "assistant-message" : "user-message"
                    }`}
                    key={`${message.timestamp || "message"}-${index}`}
                  >
                    <div className="message-avatar">
                      {message.role === "assistant" ? "F" : "U"}
                    </div>
                    <div className="message-body">
                      <div className="message-meta">
                        <strong>
                          {message.role === "assistant" ? "FlowDesk AI" : "Customer"}
                        </strong>
                        <span>
                          {message.timestamp
                            ? new Date(message.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""}
                        </span>
                      </div>
                      <p>{message.content}</p>
                    </div>
                  </div>
                ))}

                {interimText && (
                  <div className="interim-transcript">
                    <span className="status-dot" />
                    {interimText}
                  </div>
                )}

                <div id="transcript-bottom" />
              </div>
            </div>
          </article>

          <aside className="right-column">
            <article className="panel insights-panel">
              <div className="panel-heading">
                <div>
                  <div className="section-kicker">AI-POWERED</div>
                  <h3>Call insights</h3>
                </div>
                <span className="sparkle-icon">✦</span>
              </div>

              {!selectedCall ? (
                <div className="insights-empty">
                  <div className="insights-illustration">✧</div>
                  <strong>Insights appear after a call</strong>
                  <p>
                    End and save a conversation to generate a summary, customer
                    requirements, objections, and recommended next steps.
                  </p>
                </div>
              ) : (
                <div className="insights-content">
                  <div className="insight-block">
                    <span className="insight-label">SALES STATUS</span>
                    <span className={`sales-status ${getStatusClass(selectedCall.sales_status)}`}>
                      {selectedCall.sales_status}
                    </span>
                  </div>

                  <div className="insight-block">
                    <span className="insight-label">CALL SUMMARY</span>
                    <p>{selectedCall.summary || "No summary available."}</p>
                  </div>

                  <div className="insight-block">
                    <span className="insight-label">CUSTOMER REQUIREMENTS</span>
                    <p>{selectedCall.customer_requirements || "Not identified"}</p>
                  </div>

                  <div className="insight-block">
                    <span className="insight-label">OBJECTIONS</span>
                    <p>{selectedCall.objections || "None identified"}</p>
                  </div>

                  <div className="insight-block">
                    <span className="insight-label">RECOMMENDED NEXT STEPS</span>
                    <p>{selectedCall.next_steps || "Review the transcript."}</p>
                  </div>

                  {selectedCall.has_recording && selectedCall.id && (
                    <button
                      className="secondary-button full-width"
                      onClick={() => playSavedRecording(selectedCall.id)}
                    >
                      ▶ Play saved recording
                    </button>
                  )}
                </div>
              )}
            </article>

            <article className="panel status-panel">
              <div className="panel-heading">
                <div>
                  <div className="section-kicker">PIPELINE</div>
                  <h3>Sales outcomes</h3>
                </div>
              </div>

              <div className="status-list">
                {SALES_STATUSES.map((status) => {
                  const count = history.filter(
                    (item) => item.sales_status === status
                  ).length;

                  return (
                    <div className="status-row" key={status}>
                      <span className={`status-bullet ${getStatusClass(status)}`} />
                      <span>{status}</span>
                      <strong>{count}</strong>
                    </div>
                  );
                })}
              </div>
            </article>
          </aside>
        </section>

        <section className="panel history-panel" id="call-history">
          <div className="panel-heading">
            <div>
              <div className="section-kicker">YOUR RECORDS</div>
              <h3>Call history</h3>
              <p className="panel-subtitle">
                Review transcripts, AI insights, and available recordings.
              </p>
            </div>

            <button className="secondary-button" onClick={loadHistory} disabled={busy}>
              ↻ Refresh
            </button>
          </div>

          {history.length === 0 ? (
            <div className="history-empty">
              <div className="empty-icon">◷</div>
              <strong>No saved calls yet</strong>
              <p>Your completed sales calls will be listed here.</p>
            </div>
          ) : (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>CALL</th>
                    <th>DATE</th>
                    <th>DURATION</th>
                    <th>STATUS</th>
                    <th>RECORDING</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="call-title">Sales call #{item.id}</div>
                        <div className="call-summary">
                          {item.summary || "Summary unavailable"}
                        </div>
                      </td>
                      <td>{formatDate(item.created_at)}</td>
                      <td>{formatDuration(item.duration_seconds)}</td>
                      <td>
                        <span className={`sales-status ${getStatusClass(item.sales_status)}`}>
                          {item.sales_status}
                        </span>
                      </td>
                      <td>
                        {item.has_recording ? (
                          <button
                            className="text-button"
                            onClick={() => playSavedRecording(item.id)}
                          >
                            ▶ Play
                          </button>
                        ) : (
                          <span className="muted-text">Unavailable</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => openCall(item.id)}
                        >
                          View details →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>FlowDesk AI Sales Assistant</span>
          <span>Built for the Sankar Group assignment</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
