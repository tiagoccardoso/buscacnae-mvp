"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

function readPayload(element: HTMLElement) {
  const payloadText = element.dataset.analyticsPayload;
  if (!payloadText) return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(payloadText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function pushAnalyticsEvent(element: HTMLElement, fallbackAction: string) {
  const eventName = element.dataset.analyticsEvent;
  if (!eventName) return;

  const payload = {
    event: eventName,
    action: element.dataset.analyticsAction || fallbackAction,
    label: element.dataset.analyticsLabel || element.getAttribute("aria-label") || element.textContent?.trim() || "",
    pathname: window.location.pathname,
    ...readPayload(element)
  };

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
  window.dispatchEvent(new CustomEvent("buscacnae:analytics", { detail: payload }));
}

export function AnalyticsIntentListener() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const tracked = target?.closest<HTMLElement>("[data-analytics-event]");
      if (!tracked) return;
      pushAnalyticsEvent(tracked, "click");
    };

    const handleSubmit = (event: SubmitEvent) => {
      const target = event.target as HTMLElement | null;
      const tracked = target?.closest<HTMLElement>("[data-analytics-event]");
      if (!tracked) return;
      pushAnalyticsEvent(tracked, "submit");
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("submit", handleSubmit);
    };
  }, []);

  return null;
}
