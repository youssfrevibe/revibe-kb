# How the Revibe Knowledge Base AI Learns

## 🎯 Executive Overview
Traditional AI systems require expensive model re-training that takes days or weeks. 

The Revibe Knowledge Base uses an **Instant RAG Reinforcement Architecture**. It learns **in real-time** from two sources:
1. **Support Agents** giving live feedback on answers.
2. **Managers & Admins** updating policies directly through conversational teaching or document editing.

Everything takes effect in **seconds**, costs **$0 in training fees**, and leaves a **100% traceable audit log**.

---

## 🏗️ 1. System Architecture Overview

```mermaid
flowchart TB
    classDef agent fill:#1F2937,stroke:#FF8B21,stroke-width:2px,color:#FFF;
    classDef server fill:#1F2937,stroke:#3B82F6,stroke-width:2px,color:#FFF;
    classDef db fill:#1F2937,stroke:#10B981,stroke-width:2px,color:#FFF;
    classDef learn fill:#1F2937,stroke:#EC4899,stroke-width:2px,color:#FFF;
    classDef admin fill:#1F2937,stroke:#8B5CF6,stroke-width:2px,color:#FFF;

    subgraph UserLayer ["1. Support Agent Interface (/ask)"]
        A["💬 Agent Question & Market Detection"]:::agent
        B["⚡ Streamed Answers & References"]:::agent
        C["👍 / 👎 Answer Feedback Buttons"]:::agent
    end

    subgraph ServerLayer ["2. Serverless Edge & Gemini AI"]
        D["🧠 Grounding System Prompt Engine"]:::server
        E["🚀 Gemini 2.5 Flash Response Stream"]:::server
        F["📐 Gemini Embedding 001 (1536-dim)"]:::server
    end

    subgraph DBLayer ["3. Supabase pgvector Memory"]
        G["🔍 Hybrid Vector Search (Cosine + FTS)"]:::db
        H["📚 Reference Threads Pool (SRC / ALH)"]:::db
    end

    subgraph LearningLayer ["4. Instant Learning & Admin Control"]
        I["👎 Agent Correction Ingestion"]:::learn
        J["👩‍🏫 Admin Teaching Chat (/admin/teach)"]:::admin
        K["📊 Request Analysis & Tagging"]:::admin
    end

    A -->|1. Query| D
    D -->|2. Search| G
    G -->|3. Passages| H
    H -->|4. Grounded Context| E
    E -->|5. Stream Answer| B
    C -->|6. Correction| I
    I -->|7. Embed & Store| F
    F -->|8. New ALH Ref Thread| H
    J -->|9. Discuss & Edit Source| H
    E -->|10. Auto-Tagging| K
```

---

## 🔄 2. Learning Loop 1: Agent Feedback & Auto-Correction

```mermaid
sequenceDiagram
    autonumber
    actor Agent as 🧑‍💻 Support Agent
    participant UI as 📱 Knowledge Base UI
    participant Server as ⚙️ Next.js Edge Server
    participant Gemini as 🧠 Gemini Embedding API
    participant DB as 🗄️ Supabase pgvector DB

    Agent->>UI: 1. Asks question ("What is the return window for ZA?")
    UI->>Server: 2. Transmits question & market context
    Server->>DB: 3. Executes hybrid vector search
    DB-->>Server: 4. Returns relevant policy passages
    Server-->>UI: 5. Streams grounded answer with sources
    
    rect rgb(239, 68, 68, 0.1)
    Agent->>UI: 6. Clicks 👎 "Wrong Answer" & types correct policy
    end

    rect rgb(16, 185, 129, 0.1)
    UI->>Server: 7. Posts correction payload
    Server->>Gemini: 8. Generates 1536-dim vector embedding
    Gemini-->>Server: 9. Returns normalized vector
    Server->>DB: 10. Stores new ALH Reference Thread in DB
    end

    Note over DB: ⚡ Correction is instantly active in memory!

    rect rgb(59, 130, 246, 0.1)
    Agent->>UI: 11. Next agent asks similar question
    Server->>DB: 12. Hybrid search matches new ALH reference
    Server-->>Agent: 13. AI answers using updated policy!
    end
```

### Step-by-Step Breakdown:
1. **Agent Asks a Question**: An agent searches for a policy on `/ask`.
2. **Agent Flags an Inaccurate Answer**: If the AI's response is outdated or incomplete, the agent clicks **👎 Wrong Answer**.
3. **Mandatory Correction Input**: An input box appears: *"What is the correct policy?"*. The agent types the accurate rule (e.g., *"ZA return window is 14 days, not 7 days"*).
4. **Instant Ingestion & Vector Embedding**:
   - The backend converts the correction into a new **Reference Thread** tagged `ALH`.
   - It runs Gemini's embedding model (`gemini-embedding-001`) to convert the correction text into a 1536-dimensional vector.
   - The vector is stored in Supabase's `pgvector` database.
5. **Instant Knowledge Propagation**:
   - The very next time **any agent** across the team asks about ZA return windows, the hybrid search engine (`hybridSearch`) matches the newly created reference thread.
   - The AI uses the corrected policy in its response. **Zero delay, zero re-training.**

---

## 👩‍🏫 3. Learning Loop 2: Admin Conversational Teaching (`/admin/teach`)

```mermaid
flowchart LR
    classDef step fill:#1F2937,stroke:#8B5CF6,stroke-width:2px,color:#FFF;
    classDef act fill:#1F2937,stroke:#10B981,stroke-width:2px,color:#FFF;

    S1["1. Admin opens /admin/teach"]:::step --> S2["2. Discusses policy with Gemini"]:::step
    S2 --> S3["3. AI pinpoints exact source (SRC-0448 / ALH-0033)"]:::step
    S3 --> S4["4. Admin clicks source badge to Edit"]:::act
    S4 --> S5["5. ReferenceEditor updates DB & re-embeds vector"]:::act
    S5 --> S6["⚡ All future AI answers use updated wording!"]:::act
```

Admins don't need to write code or run database scripts to update the AI. They can **teach it conversationally**:

1. **Admin Discusses Policy**: Open `/admin/teach` and type: *"Where do we state the Saudi shipping SLA?"*.
2. **AI Locates Sources**: The AI identifies the exact underlying documents (e.g. `SRC-0448` or `ALH-0033`) and quotes the text verbatim.
3. **Admin Instructs Edit**: Admin types: *"Update SA shipping to 2-3 business days"*.
4. **In-Place Database Re-Embedding**: 
   - Clicking the source badge opens the `ReferenceEditor`.
   - Saving the text automatically re-calculates the vector embedding and updates the database.
   - Future AI queries instantly pull the revised policy.

---

## 🏷️ 4. Learning Loop 3: Automatic Request Categorization & Tagging

```mermaid
flowchart TD
    A["💬 Agent Completes Chat Question"] --> B["⚙️ Background Async Worker Launched"]
    B --> C["🤖 Gemini 2.5 Flash Lite Analyzes Topic"]
    C --> D["🏷️ Extracts 1-3 Tags e.g. #shipping, #warranty"]
    D --> E["🗄️ Updates Thread Record in DB"]
    E --> F["📊 Renders Top Agent Topics in /admin Dashboard"]
```

To help management understand what agents are struggling with, the system performs **Background Topic Analysis**:

1. **Asynchronous Tagging**: Once an agent's question is answered, a lightweight background model (`gemini-2.5-flash-lite`) reads the thread.
2. **Semantic Tag Extraction**: It extracts 1 to 3 topic tags (e.g., `#shipping`, `#warranty`, `#cashback`).
3. **Management Analytics**: The `/admin` dashboard aggregates these tags into real-time metrics:
   - **Top Agent Topics**: Shows what questions are asked most frequently.
   - **Accuracy Rate**: Tracks overall agent satisfaction (thumbs up vs. thumbs down %).
   - **Learning Log**: Lists all staff corrections side-by-side with original AI answers.

---

## ⚡ 5. Why This Beats Traditional AI Model Training

> [!IMPORTANT]
> **Comparison: Traditional Fine-Tuning vs. Revibe RAG Reinforcement**

| Metric | ❌ Traditional Fine-Tuning | ✅ Revibe RAG Reinforcement |
|---|---|---|
| **Time to Learn** | Days or weeks of GPU processing | **Instant (Less than 3 seconds)** |
| **Cost** | Thousands of dollars per training run | **$0 (Runs within free tier limits)** |
| **Hallucination Risk** | High (model invents or mixes facts) | **Zero (Strict grounding contract)** |
| **Audit Trail** | Black box (impossible to trace) | **100% Traceable in Admin Dashboard** |
| **Fixing Errors** | Requires full re-training run | **Single-click edit in Reference Editor** |

---

## 🚀 Summary for Managers
> *"Our AI doesn't rely on static documents. When an agent corrects an answer or an admin updates a policy, the system learns it instantly in seconds. It gets smarter every single day at zero extra cost."*
