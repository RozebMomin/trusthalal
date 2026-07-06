# How Trust Halal uses AI

This is the source-of-truth document for how Trust Halal uses artificial intelligence in our verification pipeline. It's the version we publish, share when asked, and reference when we make decisions about what AI can and can't do here.

If you're a diner, a restaurant owner, a verifier, or a community member reading this because something we said or did raised a question — thank you for asking. This is important, and we want to be direct.

## The one-line version

**Every "Trust Halal Verified" designation is made by a human. AI helps us work faster; AI does not decide whether a restaurant is halal.**

## Why we're writing this down

Halal is a religious concept with real weight in the lives of the people who follow it. Families feed their children based on what a restaurant says. Observant Muslims plan their meals around what they can trust. The word "halal" carries obligations that a marketing team can't casually reinterpret.

The wrong AI system, deployed carelessly, could cause real harm. A machine that "labels" a restaurant as halal when it isn't misleads diners into eating something they shouldn't. A machine that flags an actually-halal restaurant as suspect damages a business built on integrity. Both undermine the community's trust in the entire platform.

We take this seriously, and we think you deserve to know exactly where we draw the lines.

## What AI does at Trust Halal

We use AI in **four internal roles**. None of them are user-facing. All of them exist to help our small team review the volume of restaurant data we're processing without cutting corners on the human judgment that makes verification meaningful.

### 1. Priority scoring for the admin queue

When a new restaurant enters our system (through owner claim, verifier nomination, or public suggestion), an internal AI signal helps us decide which restaurants to review first.

**What it does:** looks at public data — the restaurant's own website language, their menu, mentions of halal in their Google reviews, cuisine correlations, whether they've uploaded a halal certificate — and produces a numeric score representing "how likely is this restaurant to be verifiable as halal-serving?" High scores go to the top of the review queue.

**What it doesn't do:** this score is never shown to consumers. It doesn't determine the verified tier. It just decides the order our human review team looks at restaurants — a productivity tool that lets us clear the queue faster.

**Why it's safe:** the outcome of a high or low score is the same — a human reviewer looks at the restaurant. The score just influences timing.

### 2. Questionnaire consistency flagging

When a restaurant owner fills out the halal questionnaire (menu posture, per-meat sourcing, alcohol policy, etc.), an AI checker looks for internal contradictions before the submission reaches a human reviewer.

**Examples of what it flags:** "fully halal menu" + "full bar with cooking-with-wine" — worth double-checking. "No pork" + a menu photo showing a pork-based item — needs a follow-up. "Zabihah chicken" + a supplier known not to offer zabihah — worth verifying.

**What it doesn't do:** it doesn't approve or reject anything. Every flagged item still gets a human review; the flag just tells the reviewer where to look first.

**Why it's safe:** the reviewer sees the flag and the raw data. If the AI's flag is wrong, the reviewer discounts it. The flag is advisory, never determinative.

### 3. Dispute pattern clustering

When multiple consumers file disputes about the same restaurant or the same claim, AI helps us cluster the disputes by common attributes — same supplier mentioned, same menu item mentioned, same time period mentioned — so admin can see the pattern quickly.

**What it does:** groups similar disputes. "Three separate diners all mentioned the chicken supplier changing in the last month" becomes a visible pattern instead of three unrelated tickets.

**What it doesn't do:** it doesn't decide whether the disputes are valid. It doesn't automatically flip a restaurant's status. It doesn't remove the badge.

**Why it's safe:** the clustering is a lens on the data, not a judgment about it. Admin still reads every dispute and makes every decision.

### 4. Certificate OCR + metadata extraction

When a restaurant uploads a halal certificate PDF or image, AI extracts the structured data — certifying body name, certificate number, issue date, expiry date, restaurant name on the cert — and pre-populates the admin review form.

**What it does:** saves the reviewer from re-typing the info. The reviewer confirms the extraction is correct before it commits to the restaurant's record.

**What it doesn't do:** it doesn't decide whether a certificate is legitimate. It doesn't rank certifying bodies. It doesn't approve or reject certificates.

**Why it's safe:** the reviewer sees the original cert alongside the extracted data. If the OCR got a number wrong, they fix it. The AI is a scanner, not a judge.

## What AI does NOT do at Trust Halal

We commit to the following, not as legal boilerplate but as principles that shape the product:

* **AI does not determine whether a restaurant is halal.** Every "Self-attested," "Certificate on file," and "Trust Halal Verified" tier is decided by a human reviewer or, for the top tier, by a human verifier's in-person visit plus a human admin's review.
* **AI does not appear as a signal to consumers.** No "AI-scored" or "AI-rated" badge, no "our algorithm says" copy anywhere on the public site.
* **AI does not evaluate the legitimacy of certifying bodies.** IFANCA vs. HFSAA vs. a local mosque's certification is a question about religious authority, not a machine-learning problem. We stay neutral.
* **AI does not read the Qur'an, hadith, or interpret religious rulings.** Halal is a religious concept. We use AI to organize data about restaurants; we don't use it to make religious judgments.
* **AI does not process private data without disclosure.** If we ever add a feature that involves AI reading private user data (e.g. dispute descriptions to route them to admin), we'll say so, here and in-product.
* **AI does not replace verifier visits.** The whole point of the Trust Halal Verified tier is that a real community verifier ate there. That doesn't get automated.

## What models we use

For the record, our AI-assisted admin tools currently use large language models via Anthropic's Claude API (specifically the Sonnet and Haiku model families) and OCR via a combination of tesseract-based open-source tools and cloud vision APIs. The models are called through our own backend; user-submitted data is not fed into third-party training pipelines beyond the operational scope of our vendors' privacy commitments.

We'll update this section when the models change.

## How we prevent AI failure from cascading

Failure modes we plan against:

* **Model hallucination on consistency flagging.** Every flag is advisory. A confidently-wrong AI flag doesn't take any action; it just points at a field the reviewer looks at. Reviewer overrides "unflag" the item.
* **OCR misreading a certificate.** The reviewer sees the original document alongside the extracted values. Wrong extractions get corrected before commit.
* **Priority scoring bias.** A biased priority score doesn't approve or reject anything — it changes review order. If we notice systemic ordering bias (e.g. under-scoring restaurants from a particular region or cuisine), we adjust or remove the scorer.
* **Model outage.** All our human review paths work without AI. If the AI service is down, our admins still review restaurants normally, just at a slower pace.

## What we do when we make a mistake

If the AI-assisted pipeline contributes to a bad decision — a restaurant is verified when it shouldn't be, or vice versa — here's what happens:

1. **We correct the record publicly.** The listing is updated with a clear explanation of what changed and why.
2. **We tell the affected parties.** The restaurant, the disputing consumer, and any verifier involved are contacted.
3. **We audit the pipeline step.** Which AI signal contributed to the wrong decision? Was it a systemic issue or a one-off?
4. **We write it up.** Major AI-related trust incidents get documented in this file's "incident log" section below (currently empty — we hope it stays that way).

## Incident log

*(Empty as of publication. Any AI-related trust incident that meaningfully affects a diner, an owner, or a verifier will be logged here with a date, description, and outcome.)*

## Feedback

If you think we've drawn a line in the wrong place — if you believe AI shouldn't be involved in one of the four internal roles listed above, or if you think we should be doing more or less with AI than we're doing — we want to hear it.

Email us at **ethics@trusthalal.org**. We read every message. We won't necessarily agree, but we'll respond.

## Change history

| Date | Change |
|---|---|
| *(publication date)* | First published. |

This document is a living version of our commitments. Substantive changes get logged here.

---

*Written by the Trust Halal team. If you'd like to reference this document publicly, please do — the URL is trusthalal.org/ethics.*
