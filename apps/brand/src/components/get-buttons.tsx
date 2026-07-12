"use client";

/**
 * Platform-aware install buttons for /get. Server-renders BOTH options
 * (so the page works with JS off and when shared to desktop), then a
 * tiny client effect detects the visitor's phone, floats their platform
 * to the top, and tags it "Recommended." Desktop visitors get a nudge
 * to open the page on their phone.
 */
import { useEffect, useState } from "react";
import { ANDROID_TEST_URL, IOS_TESTFLIGHT_URL } from "@/lib/links";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function AppleGlyph() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.12 3-.76.88-2 1.56-3.02 1.48-.13-1.1.44-2.26 1.1-3 .76-.86 2.08-1.5 3.04-1.48zM20.9 17.14c-.55 1.28-.82 1.85-1.53 2.98-.99 1.58-2.39 3.55-4.12 3.56-1.54.02-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.02-3.06-1.8-4.05-3.38C-.02 16.9-.34 11.8 1.9 9.02 3 7.6 4.68 6.76 6.28 6.76c1.63 0 2.66 1 4.01 1 1.29 0 2.08-1 4-1 .72 0 2.76.07 4.05 1.98-3.53 1.93-2.95 6.99-1.44 8.4z" />
    </svg>
  );
}

function AndroidGlyph() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.6 9.48l1.84-3.18a.4.4 0 10-.7-.4l-1.86 3.23a11.4 11.4 0 00-8.76 0L6.27 5.9a.4.4 0 10-.7.4L7.4 9.48A10.8 10.8 0 002 18h20a10.8 10.8 0 00-4.4-8.52zM7 15.25a1 1 0 110-2 1 1 0 010 2zm10 0a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  );
}

function StoreButton({
  href,
  glyph,
  kicker,
  label,
  recommended,
  primary,
}: {
  href: string;
  glyph: React.ReactNode;
  kicker: string;
  label: string;
  recommended: boolean;
  primary: boolean;
}) {
  return (
    <a
      href={href}
      className={[
        "group relative flex items-center gap-3 rounded-2xl border px-5 py-4 transition",
        primary
          ? "border-transparent bg-accent text-onaccent shadow-sm hover:bg-accent-deep"
          : "border-line bg-surface text-ink hover:border-accent/40 hover:shadow-sm",
      ].join(" ")}
    >
      <span className={primary ? "text-onaccent" : "text-ink"}>{glyph}</span>
      <span className="flex flex-col leading-tight">
        <span className={["text-[11px] font-medium", primary ? "text-onaccent/80" : "text-sub"].join(" ")}>
          {kicker}
        </span>
        <span className="text-[15px] font-semibold tracking-tight">{label}</span>
      </span>
      {recommended ? (
        <span
          className={[
            "ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
            primary ? "bg-white/20 text-onaccent" : "bg-accent-soft text-accent-deep",
          ].join(" ")}
        >
          For your device
        </span>
      ) : null}
    </a>
  );
}

export function GetButtons() {
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => setPlatform(detectPlatform()), []);

  const ios = (
    <StoreButton
      key="ios"
      href={IOS_TESTFLIGHT_URL}
      glyph={<AppleGlyph />}
      kicker="iPhone · TestFlight"
      label="Install on iOS"
      recommended={platform === "ios"}
      primary={platform === "ios" || platform === "other"}
    />
  );
  const android = (
    <StoreButton
      key="android"
      href={ANDROID_TEST_URL}
      glyph={<AndroidGlyph />}
      kicker="Android · Google Play"
      label="Join the Android test"
      recommended={platform === "android"}
      primary={platform === "android"}
    />
  );

  const order = platform === "android" ? [android, ios] : [ios, android];

  return (
    <div className="w-full max-w-md">
      <div className="flex flex-col gap-3">{order}</div>
      {platform === "other" ? (
        <p className="mt-3 text-center text-sm text-sub">
          Trust Halal is a phone app — open{" "}
          <span className="font-medium text-ink">trusthalal.org/get</span> on your iPhone or
          Android, or email yourself this link.
        </p>
      ) : (
        <p className="mt-3 text-center text-sm text-sub">
          Free · takes a minute · your feedback shapes what we build.
        </p>
      )}
    </div>
  );
}
