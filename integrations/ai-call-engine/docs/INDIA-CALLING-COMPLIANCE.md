# India Calling Compliance Guide

> **Disclaimer:** This document is a technical and operational summary for engineering teams and does **not** constitute legal advice. Always have your legal/compliance counsel review your exact use case, consent wording, and carrier contracts before placing automated calls in India.

Operating automated outbound voice calls to Indian phone numbers (`+91`) requires compliance with **TRAI (Telecom Regulatory Authority of India)** regulations under the *Telecom Commercial Communications Customer Preference Regulations (TCCCPR), 2018* and Department of Telecommunications (DoT) guidelines.

## 1. TRAI Regulations Overview

TRAI strictly regulates unsolicited commercial communications (UCC) and automated voice calls:

- **Transactional / Service vs. Promotional**: Automated closure notifications tied to an active customer ticket generally fall under **Transactional / Service** communications *only* if they strictly convey service resolution details without upselling or marketing content.
- **Calling Hours**: Promotional calls are barred outside permitted hours (typically 09:00–21:00 IST). Even for service/transactional calls, limiting automated calls to reasonable daytime hours (e.g., 09:00–20:00 IST) reduces customer complaints and regulatory risk.
- **Clear Caller Identification**: The AI assistant should immediately announce the organization name (`metadata.organization`) and the reason for the call (`requestId` / resolution).

## 2. DND / NCPR (National Customer Preference Register)

- Customers registered on the **NCPR / DND** registry block promotional calls and specific category calls.
- Even when relying on explicit customer consent, you should:
  1. Capture verifiable opt-in consent (`consent.automatedCallAllowed` + `consent.consentReference`) at ticket creation.
  2. Support immediate opt-out ("Press 9" or verbal opt-out) and add opted-out numbers to AI Call Engine's suppression list (`addToSuppressionList`).
  3. Cross-check carrier DND scrubbing capabilities with your Indian telecom provider.

## 3. DLT (Distributed Ledger Technology) Registration

TRAI mandates entity and template registration on operator **DLT portals** (such as Jio Trueconnect, Airtel DLT, Vodafone Idea VILPower, BSNL, or Tata Tele):

- **Principal Entity (PE) Registration**: Your organization must register as a Principal Entity with valid business KYC (PAN, GSTIN, incorporation docs).
- **Header / CLI Registration**: Outbound calling numbers (CLIs) and headers must be registered under your PE account.
- **Consent & Template Scrubbing**: Voice/SMS templates and customer consent records may require DLT template IDs and periodic consent scrubbing depending on carrier enforcement for automated voice calls.

## 4. Calling Number (CLI) Requirements

- Outbound calls into India must display a valid, traceable, DLT-registered Indian CLI (or approved international-to-India routing where permitted; note that Indian telecom operators frequently block or flag unverified/spoofed CLIs and VoIP-terminated `+91` calls without proper KYC).
- International VoIP numbers calling Indian mobiles may face higher carrier spam labeling ("Spam Likely") or blocking compared to verified domestic SIP/PSTN termination.

## 5. Automated Calling Restrictions Under TRAI

- Pre-recorded or AI-generated outbound calls (robocalls) face heightened scrutiny under TCCCPR.
- **No promotional content**: Never mix marketing offers, surveys with promotional incentives, or upsells into a `REQUEST_CLOSED` service call.
- **Retry discipline**: Excessive redialing of unanswered numbers can trigger carrier spam blocks. Keep `MAX_RETRY_ATTEMPTS` conservative (e.g., `2`–`3` max) with meaningful backoff delays.

## 6. KYC Requirements for Telephony

Before provisioning Indian outbound voice trunks or `+91` numbers with Twilio, Vonage, Exotel, or domestic SIP providers, you must complete **DoT/TRAI KYC**:
- Certificate of Incorporation / Business Registration
- Company PAN & GST Certificate
- Authorized Signatory ID & Address Proof
- Board Resolution / Authorization Letter
- Registered Office Address Proof & Use-Case Declaration

## 7. Vapi + Twilio for India: Configuration & Procurement

1. **Twilio Account & KYC**: Complete Twilio's India Regulatory Bundle / KYC verification and request Indian voice capabilities or verified outbound caller IDs.
2. **Phone Number Procurement**:
   - Note that procuring a local `+91` voice-capable number via international CPaaS providers may have regulatory restrictions (e.g., OSP / domestic termination rules). Verify directly with Twilio India or a licensed Indian TSP/VNO.
3. **Import into Vapi**:
   - In the Vapi dashboard, go to **Phone Numbers -> Import Twilio Number**, supply your Twilio Account SID, Auth Token, and approved phone number.
   - Copy the resulting `VAPI_PHONE_NUMBER_ID` into `.env`.
4. **Webhook & Latency Setup**:
   - Point Vapi webhooks to your HTTPS `/api/webhooks/voice` endpoint and set `VAPI_WEBHOOK_SECRET`.
   - Test voice clarity, accent recognition (Indian English / Hindi / Tamil), and response latency over real Indian mobile carriers (Jio, Airtel, Vi).

## 8. Unresolved Compliance Questions (Require Legal Review)

Before launching in production in India, obtain formal sign-off from legal counsel on:

1. **Classification of AI Interactive Closure Calls**: Whether interactive LLM-driven closure confirmation calls qualify strictly as "Service Calls" vs. "Transactional" vs. "Promotional" under your specific industry regulator (e.g., RBI for fintech, IRDAI for insurance, TRAI TCCCPR).
2. **DLT Voice Scrubbing Enforcement**: Current enforcement status of DLT scrubbing for outbound AI voice calls on your chosen carrier/aggregator.
3. **Call Recording & Transcript Consent**: Whether announcing "this call may be recorded for quality purposes" is mandatory at call start and where transcripts/recordings may be stored (data localization rules under India's **DPDP Act, 2023**).
4. **Cross-Border Voice Data Processing**: Compliance implications under the Digital Personal Data Protection (DPDP) Act, 2023 when routing Indian customer voice/text through US/EU-hosted AI providers (Vapi, OpenAI, Deepgram, ElevenLabs).
5. **OSP (Other Service Provider) Guidelines**: Whether your deployment architecture triggers DoT OSP compliance or domestic PSTN interconnection rules.
6. **Do-Not-Disturb Override Validity**: Whether your ticket submission opt-in checkbox satisfies TRAI's explicit digital consent acquisition format to call DND-registered numbers.

## 9. Recommended Pre-Production Steps

1. Complete business KYC and DLT Principal Entity registration.
2. Have legal counsel review your ticket opt-in consent language and AI call script.
3. Enforce quiet hours (e.g., 09:00–20:00 IST) in your triggering application or queue scheduler.
4. Implement an automated opt-out flow that writes immediately to the AI Call Engine suppression list.
5. Run a closed pilot with internal/test numbers across Jio, Airtel, and Vi to verify CLI display, audio quality, and webhook delivery.
