# Consumer Email Templates

Six email types to start sending. Use whichever email service you have (Resend is already wired in the backend; Buttondown or Substack for the newsletter). All copy below.

---

## 1. Waitlist welcome (immediate, transactional)

**Trigger:** someone joins the waitlist on halalfoodnearme.com.

**Subject:** Welcome to Trust Halal — here's what happens next

**Body:**

> Hi [first name],
>
> Welcome. You're on the Trust Halal waitlist for **[city, if collected, else "your area"]**.
>
> Here's the short version of what's happening:
>
> 🌿 We verify halal restaurants — supplier, slaughter method, certificate on file — and list them at halalfoodnearme.com.
>
> 📍 We're rolling out city by city. Cities with the biggest waitlists go first.
>
> 📨 One email a week, max. No spam. Mostly: new verified restaurants in your area, occasional updates we think you'd care about.
>
> Two ways you can help speed up your area:
>
> 1. **Forward this email to friends.** Bigger waitlist = sooner launch in your city.
>
> 2. **Tell us about a restaurant we should verify.** Reply with the name and we'll reach out to them directly. Especially: places you eat at regularly and trust.
>
> Thanks for being here.
>
> — The Trust Halal team
> halalfoodnearme.com

**Notes:**
* Plain-text feel even though it's HTML. No fancy header images, no template chrome. Looks like an email from a person.
* The two calls-to-action (forward, nominate) are doing real work — most waitlist welcomes don't ask the user to DO anything. This one does.

---

## 2. New restaurants near you (weekly digest)

**Trigger:** weekly, only sent when there are 1+ new verified restaurants in the user's area.

**Subject:** [N] new halal restaurants verified in [City] this week

**Body:**

> Hi [first name],
>
> Three new spots in [City] joined the verified list this week 🌿
>
> ---
>
> **[Restaurant 1 Name]** — [Cuisine] in [Neighborhood]
> [One-line specific detail: "Zabihah chicken from [Supplier]. Cert on file from [Authority]." or "Fully halal menu. Beer and wine on premises."]
> [View listing →](https://halalfoodnearme.com/places/[slug])
>
> ---
>
> **[Restaurant 2 Name]** — [Cuisine] in [Neighborhood]
> [One-line specific detail]
> [View listing →](https://halalfoodnearme.com/places/[slug])
>
> ---
>
> **[Restaurant 3 Name]** — [Cuisine] in [Neighborhood]
> [One-line specific detail]
> [View listing →](https://halalfoodnearme.com/places/[slug])
>
> ---
>
> Browse the full directory in [City]: halalfoodnearme.com/[city-slug]
>
> Know a place that should be on the list? Reply to this email with the name and we'll reach out.
>
> — Trust Halal

**Notes:**
* If only 1 new restaurant, the digest still goes — just adjust copy ("One new spot...").
* If 0 new, SKIP the email that week. Sending an empty digest is worse than sending nothing.
* The "reply with a nomination" loop is a powerful flywheel. Wire it to feed your owner outreach queue.

---

## 3. Restaurant of the month (monthly feature)

**Trigger:** monthly, the 1st. Highlights one verified restaurant in depth.

**Subject:** Verified spotlight: [Restaurant Name] in [City]

**Body:**

> Hi [first name],
>
> Every month we feature one verified restaurant in depth — a chance to learn the story behind a place you might end up eating at.
>
> **This month: [Restaurant Name] in [City]** — [cuisine description].
>
> [Photo of a hero dish if available; alt: a photo of the restaurant exterior. Real photo, not stock.]
>
> [2–3 paragraphs about the restaurant. Keep it human. Include:
>   * Why this restaurant matters to the community
>   * What the owner's halal sourcing story is — supplier, slaughter method, the back-story
>   * One specific dish people should try
>
> Voice is warm and specific. Not promotional, not glowing-review style.]
>
> > "[Quote from owner — about their commitment to halal, their supplier relationship, why they got verified. Should sound human.]"
> > — [Owner first name], owner of [Restaurant Name]
>
> Read the full listing → halalfoodnearme.com/places/[slug]
>
> Or browse the full directory → halalfoodnearme.com
>
> Thanks for being here.
>
> — Trust Halal

**Notes:**
* This email is a content piece. Plan it 1–2 weeks in advance. Actually interview the owner — 15 minutes on the phone or in person.
* Don't try to write this if you don't have the owner's quote and a real story. Better to skip than ghostwrite.
* Pair the email with a social post featuring the same restaurant (template 5 from `consumer-posts.md`).

---

## 4. Featured-restaurant announcement (for the owner)

**Trigger:** after you've published the restaurant-of-the-month email.

**Subject:** [Restaurant Name] — you're our featured restaurant this month

**Body:**

> Hi [Owner first name],
>
> Wanted to give you a heads-up: we featured **[Restaurant Name]** in our monthly newsletter today. It went out to [N] subscribers in [City] and surrounding areas.
>
> Email here: [link to the web version]
> Social post: [link]
>
> If you'd like to share it on your channels, here's a graphic you can use: [link to the featured-restaurant social SVG, prefilled with their name]
>
> Thanks for the food — and thanks for being verified.
>
> — Trust Halal

**Notes:**
* This is a quiet, kind email. It's not asking the owner to do anything; it's letting them know we did something for them.
* Owners often want to repost. Making it easy (the prefilled graphic) is the right move.

---

## 5. Re-engagement (90-day inactivity)

**Trigger:** subscriber hasn't opened an email in 90 days.

**Subject:** Are you still interested in halal restaurant updates?

**Body:**

> Hi [first name],
>
> Quick check-in. You signed up for Trust Halal updates a while back, but it looks like our emails haven't been useful lately.
>
> Two things you can do:
>
> 1. **Stay subscribed** — no action needed. Hit reply if there's something specific you'd want to hear about.
>
> 2. **Unsubscribe** — totally fine, no hard feelings. [Unsubscribe link]
>
> We send one email a week max. If that's still useful, great — we'll be here. If not, no offense taken.
>
> — Trust Halal

**Notes:**
* Re-engagement protects sender reputation. Better to unsubscribe a dormant address than risk being marked as spam.
* The "no hard feelings" framing is on-voice and reduces guilt.

---

## 6. Owner cold outreach via email (different from the cold-outreach.md templates — same content, just as a sendable email)

See `owner/cold-outreach-email.md` for templates A, B, C. Set them up as actual sendable emails in your Gmail / outreach tool.

---

## 7. Disputed-listing notification (transactional)

**Trigger:** when a consumer files a dispute on a listing the owner manages.

**Subject:** A diner reported a question on [Restaurant Name]'s listing

**Body:**

> Hi [Owner first name],
>
> A diner filed a question about your Trust Halal listing for **[Restaurant Name]**.
>
> **Their report:** [the dispute's category — "Pork served on menu" / "Slaughter method incorrect" / etc.]
>
> **Their note:**
> > "[The dispute description, verbatim]"
>
> What happens next:
>
> 1. You have 7 days to respond — agree, disagree, or update your listing.
> 2. If we don't hear from you, the listing stays as-is and our review team takes it from there.
>
> Respond to the dispute → [link to the owner portal dispute page]
>
> Most disputes resolve at this step. Quick response keeps your listing accurate and your verified badge intact.
>
> — Trust Halal
> hello@trusthalal.org

**Notes:**
* This is a serious email — keep it factual, not alarmist.
* The 7-day window is firm; mentions in body so the owner knows the timeline.

---

## Tone calibration across emails

| Email | Tone |
|---|---|
| Waitlist welcome | Warm, brief, asks for action |
| Weekly digest | Plainspoken, informational |
| Featured restaurant | Editorial, careful, specific |
| Featured-restaurant heads-up to owner | Quiet, kind, "we did something for you" |
| Re-engagement | Respectful of the user's time |
| Dispute notification | Factual, time-sensitive, no panic |

## General rules

* **Plain-text feel.** Even when sending HTML, design for it to look like a person wrote it. No giant header images, no marketing-template chrome.
* **Subject lines under 60 characters.** Mobile inbox cuts them off.
* **Specifics in the subject when possible.** "3 new halal restaurants in Brooklyn this week" beats "Trust Halal weekly digest."
* **One CTA per email.** Multiple links are fine, but one primary action.
* **Unsubscribe link visible in every email.** Always — even for transactional. Builds trust.
* **From line consistency.** "Trust Halal <hello@trusthalal.org>" for everything. Don't fragment across multiple senders.

## Cadence

| Email type | Frequency |
|---|---|
| Waitlist welcome | Immediate, one-time per signup |
| Weekly digest (when content available) | Weekly, skipped when nothing new |
| Featured restaurant | Monthly, 1st of the month |
| Featured-restaurant heads-up to owner | Immediate when featured email goes out |
| Re-engagement | Once per 90-day inactivity stretch |
| Dispute notification | Real-time on dispute filing |

If you do all of the above, the average subscriber gets 4–6 emails per month. That's the right ceiling for a brand at this stage.
