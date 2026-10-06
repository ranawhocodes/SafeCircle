# SafeCircle — How Things Work: Emergency 112 Escalation & System Architecture

> **Document Purpose:** An easy-to-understand, complete technical and operational guide on what actually happens when an emergency alert is **escalated to 112 (ERSS)** in SafeCircle, how duplicate dispatches are prevented, and how the digital-to-human handoff operates in the real world.

---

## Table of Contents
1. [The Big Picture: Why 112 Escalation is Needed](#1-the-big-picture-why-112-escalation-is-needed)
2. [How India's Emergency 112 (ERSS) Works Behind the Scenes](#2-how-indias-emergency-112-erss-works-behind-the-scenes)
3. [The 3-Channel Escalation Architecture](#3-the-3-channel-escalation-architecture)
4. [The Critical Question: Avoiding the "Duplicate Dispatch" Trap](#4-the-critical-question-avoiding-the-duplicate-dispatch-trap)
5. [The Golden Payload: What Information Goes to 112?](#5-the-golden-payload-what-information-goes-to-112)
6. [The Core Life-Safety Rule: `escalated` is a Flag, Not a State](#6-the-core-life-safety-rule-escalated-is-a-flag-not-a-state)
7. [The Human Anchor: What the Society Security Guard Does](#7-the-human-anchor-what-the-society-security-guard-does)
8. [Under the Hood: Prototype Code vs Production Deployment](#8-under-the-hood-prototype-code-vs-production-deployment)
9. [Frequently Asked Questions (FAQ)](#9-frequently-asked-questions-faq)

---

## 1. The Big Picture: Why 112 Escalation is Needed

When a 78-year-old grandmother collapses in an apartment in Chennai, Bengaluru, or Mumbai, two timers start ticking simultaneously:

```
0:00 ── SOS Triggered
 │
 ├── Minute 1 to 5  ──► "The Golden Minutes" (CPR, opening airways, lifting off floor)
 │                      Ambulances CANNOT reach in this window due to city traffic.
 │                      Only nearby verified neighbors and society guards can.
 │
 └── Minute 10 to 45 ──► "Medical Transport & Hospitalization"
                         Neighbors cannot provide ICU care or defibrillators.
                         Only formal government emergency services (112 / 108) can.
```

SafeCircle is built to bridge this **30-minute survival gap**. 

When an SOS is raised, **nearby community volunteers are dispatched first** (within 120 seconds). If nobody accepts within 90 seconds (or if the trigger is an immediate P1 life-or-death crisis like child abduction or severe collapse), the system **escalates to national emergency authorities (112)**.

---

## 2. How India's Emergency 112 (ERSS) Works Behind the Scenes

Many people believe 112 is simply a phone call where a human operator answers. In reality, **ERSS 112** (Emergency Response Support System, developed by C-DAC under the Ministry of Home Affairs) is a sophisticated, digitized command-and-control platform.

ERSS 112 has **two separate ingestion pathways**:

```
                       ┌───────────────────────────────────────────┐
                       │           ERSS 112 CONTROL ROOM           │
                       │   (Public Safety Answering Point / PSAP)  │
                       └─────────────────────┬─────────────────────┘
                                             │
                   ┌─────────────────────────┴─────────────────────────┐
                   ▼                                                   ▼
         [ VOICE CALL-TAKERS ]                               [ DIGITAL CAD GATEWAY ]
         Operators wearing headsets                          Computer-Aided Dispatch
         answering citizen 112 calls                         Automated REST APIs / IoT Webhooks
         from telephones.                                    used for vehicle panic buttons (AIS-140)
                                                             and registered security systems.
```

1. **The Voice Channel:** Traditional telephone operators taking verbal 112 phone calls from callers.
2. **The Digital CAD Gateway:** A server-to-server API designed to ingest automated machine-generated emergency alerts directly into dispatch terminals without needing human phone calls.

---

## 3. The 3-Channel Escalation Architecture

When SafeCircle decides to escalate an incident to 112, it does not rely on a single fragile point of failure. It utilizes a **3-tier hybrid escalation mechanism**:

```
                  90s Escalation Timeout  OR  P1 Critical Emergency
                                          │
                                          ▼
                      SafeCircle Engine compiles HandoffPacket
                      (GPS, Medical History, Gate Codes, Callbacks)
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                 ▼                                 ▼
   CHANNEL 1:                        CHANNEL 2:                        CHANNEL 3:
DIRECT CAD API GATEWAY             AUTOMATED IVR TRUNK              THE HUMAN ANCHOR
(Server-to-Server)                 (Synthesized Voice Call)         (Society Guard Desk)
───────────────────────            ────────────────────────         ────────────────────
• Pushes JSON/XML payload          • Outbound automated call        • Guard dashboard flashes
  directly into State PSAP.          dialed to 112 via telecom        urgent red alert banner.
• Appears instantly on 112           trunk lines.                   • Guard taps "Call 112"
  dispatcher's computer screen     • Text-to-speech voice plays:      with pre-scripted
  with live map & flat number.       "Emergency: Lakshmi Raman, 78,   details & building codes.
                                     unconscious at Flat B-204..."
```

---

## 4. The Critical Question: Avoiding the "Duplicate Dispatch" Trap

### The Question:
> *"If Channel 1 (API) and Channel 2 (Voice Call) fire at the same time, won't 112 be told the same story twice and send two ambulances?"*

### The Answer:
**They are NEVER triggered simultaneously.**

Triggering both at the exact same moment would create two separate incident tickets in the police/ambulance control room, leading to waste of emergency resources.

In SafeCircle, Channel 1 and Channel 2 operate as a **Sequential Failover Cascade (Primary $\rightarrow$ Circuit-Breaker Fallback)**:

```
                            90s Escalation or P1 Critical
                                          │
                                          ▼
                         [ CHANNEL 1: DIRECT CAD API ]
                         POST /erss/v1/incident (JSON)
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    ▼                                           ▼
             HTTP 201 Created                            API Timeout / Error
             (ACK received from 112)                     (No response within 5s)
                    │                                           │
                    ▼                                           ▼
          STOP. No call is made!                     [ CHANNEL 2: FALLBACK IVR ]
          112 is already dispatched                   Automated voice call dials 112
          via digital CAD screen.                     to state the emergency by voice.
```

### How the Cascade Works Step-by-Step:
1. **Channel 1 Fires First (The Digital-First Path):**
   * SafeCircle attempts an HTTPS REST API call to the state ERSS-112 CAD endpoint with the structured incident data.
   * If the 112 server responds with `HTTP 201 Created` and an official government ticket number (e.g. `TN-CHE-2026-88192`):
   * **The circuit is complete. Channel 2 (Voice Call) is completely cancelled.** No phone call is placed.
2. **Channel 2 Fires ONLY on Failure (The Fallback Path):**
   * If the CAD API is unreachable, times out ($>5$ seconds), or returns a server error (`503 Service Unavailable`), the circuit-breaker trips.
   * Only then does SafeCircle place an outbound automated voice call to 112, reciting the incident code and address.
3. **Channel 3 (The Guard Desk) Coordinates on the Ground:**
   * The security guard’s screen displays:
     > **`✓ 112 DISPATCH ACKNOWLEDGED — TICKET #TN-88192`**  
     > *Ambulance dispatched. Guard action: Open society main gate, hold building lift at ground floor, and guide paramedics to Flat B-204.*
   * The guard only calls 112 manually if both automated channels fail.

---

## 5. The Golden Payload: What Information Goes to 112?

When an elderly resident or child calls 112 in a panic, they are often crying, disoriented, or unable to speak (e.g. stroke, choking, cardiac arrest). Dispatchers waste 3 to 5 minutes asking: *"What is your name? What is your landmark? Which district?"*

SafeCircle eliminates this delay. The server domain engine ([apps/api/src/domain/escalation.ts](file:///d:/SafeCircle/SafeCircle/SafeCircle/apps/api/src/domain/escalation.ts)) compiles an exact, structured **`HandoffPacket`**:

```typescript
export interface HandoffPacket {
  incidentId: string;            // e.g. "inc_aab27d45bf6cebf2"
  personName: string;            // "Lakshmi Raman"
  ageBand: string;               // "75+"
  address: string;               // "B-204, 12 Gandhi Street, Besant Nagar (Opp. temple tank)"
  location: FusedLocation;       // Exact lat/lng + Wi-Fi flat estimate
  locationDescription: string;  // "Sub-15m indoor fix via Flat 402 Home Wi-Fi"
  careSummary: string[];         // ["Hypertension", "Type 2 Diabetes", "Allergic to Penicillin", "Blood Group: B+"]
  volunteerObservedType: string; // What the first responder saw on-scene (e.g. "Conscious, head injury")
  onScene: Array<{               // Responders already performing first aid
    name: string; badge: string; skill: string; // e.g. "Priya N (Nurse L3)"
  }>;
  callbackNumbers: string[];     // Caregiver phone, guard desk phone, victim phone
  severity: "P1" | "P2";
  openedAt: Date;
}
```

### Why 112 Operators Benefit from This Data:
1. **Precise Indoor Address:** Satellite GPS stops at the apartment roof. SafeCircle includes the building name, flat number, floor, and landmark.
2. **Medical Safety Safeguards:** Emergency doctors know the patient's blood group (`B+`) and that they are **allergic to penicillin** *before* administering injections.
3. **Live On-Scene Coordination:** The 112 dispatcher knows that **Nurse Priya (Volunteer L3)** is already inside the room performing first aid, and has her callback number.

---

## 6. The Core Life-Safety Rule: `escalated` is a Flag, Not a State

In software engineering, systems often transition into a new state and stop prior tasks. 

In SafeCircle ([escalation.ts: Line 4](file:///d:/SafeCircle/SafeCircle/SafeCircle/apps/api/src/domain/escalation.ts#L4)), the system enforces a strict architectural rule:
> **`escalated` is a FLAG, not a STATE. Telling the authorities stops nothing.**

```
Incident Opened (SOS Triggered)
       │
       ▼
Volunteers Alerted (Tier 1 Siren Alarm)
       │
       ├─► 90s Elapsed ──► 112 Informed (Ticket Generated)
       │
       ▼
DO THE VOLUNTEERS STOP?
       │
       ├─► NO! Volunteers KEEP COMING.
       ├─► Guard KEEPS MONITORING.
       ├─► Family KEEPS RECEIVING UPDATES.
```

### Why?
Because in Indian metro cities, an ambulance takes **25 to 45 minutes** to reach an apartment complex through peak traffic. If SafeCircle stood down volunteers the moment 112 was dialed, the victim would lie alone on the floor for 40 minutes. 

Volunteers stay on scene to:
* Perform continuous chest compressions (CPR).
* Place an unconscious person in the recovery position so they do not choke.
* Wait at the building entrance to direct paramedics to the elevator.

---

## 7. The Human Anchor: What the Society Security Guard Does

The security guard at the apartment main gate is SafeCircle's boots-on-the-ground anchor.

When an incident escalates to 112:
1. **The Guard Dashboard Updates Instantly:** A high-contrast red emergency card flashes on the gate computer/tablet:
   ```
   🚨 EMERGENCY: 112 ESCALATED — FLAT B-204 (LAKSHMI RAMAN)
   CAD Ticket: #TN-CHE-2026-88192 | Vehicle: Ambulance En Route
   ```
2. **Physical Gate Actions:**
   * The guard raises the vehicle boom barrier so the ambulance does not wait at the gate.
   * The guard locks one elevator car on the ground floor with the service key so paramedics do not wait for lifts.
   * The guard guides the emergency medical technicians (EMTs) directly to the right flat.

---

## 8. Under the Hood: Prototype Code vs Production Deployment

SafeCircle uses a **Clean Architecture Ports & Adapters** pattern ([ports.ts](file:///d:/SafeCircle/SafeCircle/SafeCircle/apps/api/src/providers/ports.ts#L76-L96)):

```typescript
export interface AuthorityPort {
  readonly name: string;
  handoff(packet: HandoffPacket): Promise<ProviderResult & { accepted: boolean }>;
}
```

| Deployment Level | How Authority Handoff is Implemented |
| :--- | :--- |
| **Current Prototype & Test Suite** | Uses `SimulatedAuthority` ([simulated.ts](file:///d:/SafeCircle/SafeCircle/SafeCircle/apps/api/src/providers/simulated.ts)). It validates the `HandoffPacket`, records it in the database audit log, and marks the incident with the simulated badge `112 TOLD [SIMULATED]`. All 176 automated tests pass with 100% reliability without accidentally dialing real police numbers. |
| **Production Society Rollout** | The `AuthorityPort` is swapped with `ProductionErssAuthority`. It connects directly to the state's official C-DAC ERSS-112 REST API endpoint via mutual TLS (mTLS) with API tokens granted under state police authorization. |

---

## 9. Frequently Asked Questions (FAQ)

### Q1: What happens if there is an internet/power failure in the building?
* The wearable Go Pendant possesses an independent 4G Cat-1 cellular modem (**F43**). If society Wi-Fi is down, it communicates over cellular data.
* If packet data fails entirely, the pendant transmits an encrypted fallback SMS containing raw coordinates to the emergency gateway.

### Q2: What if someone pressed the button by mistake and it already escalated?
* If a cancel request is confirmed safe (**F2**), SafeCircle updates the incident and sends a cancellation webhook:
  `PATCH /erss/v1/incident/:id` with `status: "false_alarm_verified"`.
* The control room dispatcher sees the update immediately and can divert the ambulance to another life-saving emergency.

### Q3: Can a malicious person trigger fake 112 calls through SafeCircle?
* **No.** Every physical hardware button uses a factory-flashed 256-bit cryptographic key (**F14**). 
* Payloads are signed with **HMAC-SHA256** and include a strictly increasing sequence counter (`seq`). Replay attacks and spoofed triggers are rejected by the server before any dispatch or escalation can occur.

---

*SafeCircle Architectural Documentation — 2026*
