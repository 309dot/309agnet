import React, { useEffect, useMemo, useRef } from "react";

const ProgressCircleIcon = ({ spinning }) => (
  <svg
    className={spinning ? "agent-progress-circle spinning" : "agent-progress-circle"}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="8" cy="8" r="7" stroke="var(--agent-progress-base, #BDBDBD)" strokeWidth="2" />
    <path
      d="M8 15C11.866 15 15 11.866 15 8C15 4.13401 11.866 1 8 1"
      stroke="var(--agent-progress-fill, #0B98FF)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const SendArrowIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 10.3707 10.6667"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M5.852 2.552V10.6667H4.51867V2.552L0.942667 6.128L0 5.18533L5.18533 0L10.3707 5.18533L9.428 6.128L5.852 2.552Z"
      fill="white"
    />
  </svg>
);

const StopIcon = () => (
  <span className="agent-stop-icon" aria-hidden="true" />
);

const LedDot = ({ state, label }) => (
  <span
    className={
      state === "green"
        ? "agent-led agent-led--green"
        : state === "red"
          ? "agent-led agent-led--red"
          : "agent-led agent-led--gray"
    }
    role="img"
    aria-label={label}
    title={label}
  />
);

export default function PromptComposer({
  request,
  onChangeRequest,
  onSend,
  onStop,
  runningState, // idle|running|stopping
  disabled,
  progressUi
}) {
  const textareaRef = useRef(null);

  const placeholder = useMemo(
    () => "요청사항을 말씀해주세요",
    []
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const onKeyDown = (event) => {
      if (event.key !== "Enter") return;
      if (event.isComposing) return;

      const isCmd = event.metaKey && !event.ctrlKey;
      if (event.shiftKey) return; // newline
      if (isCmd) {
        event.preventDefault();
        onSend?.();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [onSend]);

  const sendDisabled = disabled || !request.trim();
  const isRunning = runningState === "running" || runningState === "stopping";
  const buttonMode = isRunning ? "stop" : "send";

  return (
    <div className="composer agentchat-input">
      {progressUi?.visible ? (
        <div className="agent-progress-area">
          <div className="agent-progress" role="status" aria-live="polite">
            <div className="agent-progress-left">
              <ProgressCircleIcon spinning={Boolean(progressUi?.spinning)} />
              <div className="agent-progress-texts">
                <div className="agent-progress-topline">
                  <LedDot state={progressUi?.healthLed} label="서버 상태" />
                  <LedDot state={progressUi?.logLed} label="로그 증가" />
                  <div className="agent-progress-text">{progressUi?.label ?? ""}</div>
                </div>
                {progressUi?.statusText ? (
                  <div className="agent-progress-subtext">{progressUi.statusText}</div>
                ) : null}
              </div>
            </div>
            <div className="agent-progress-right">
              {progressUi?.actions?.map((a) => (
                <button
                  key={a.id}
                  className={
                    a.kind === "primary"
                      ? "agent-pill primary"
                      : a.kind === "link"
                        ? "agent-link"
                        : "agent-pill"
                  }
                  onClick={a.onClick}
                  type="button"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="agent-chat-area">
        <textarea
          ref={textareaRef}
          value={request}
          onChange={(event) => onChangeRequest(event.target.value)}
          placeholder={placeholder}
          rows={3}
          disabled={disabled}
        />

        <div className="agent-chat-actions">
          <button
            className="agent-send"
            onClick={buttonMode === "send" ? onSend : onStop}
            disabled={buttonMode === "send" ? sendDisabled : runningState === "stopping"}
            title={buttonMode === "send" ? "보내기 (Cmd+Enter)" : "중지"}
            aria-label={buttonMode === "send" ? "보내기" : "중지"}
            type="button"
          >
            {runningState === "stopping" ? (
              <span className="spinner" aria-hidden="true" />
            ) : buttonMode === "stop" ? (
              <StopIcon />
            ) : (
              <SendArrowIcon />
            )}
          </button>
        </div>
      </div>

      {progressUi?.notice ? <div className="agent-progress-note">{progressUi.notice}</div> : null}
    </div>
  );
}
