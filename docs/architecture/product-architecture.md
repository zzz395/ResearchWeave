# ResearchWeave Product Architecture

## Product vision

ResearchWeave is a focused research collaboration workspace where a small team can discover academic work, organize source documents, discuss them in real time, ask grounded questions, compare evidence, and delegate bounded research tasks to transparent tool-calling agents.

The product promise is not “AI that appears busy.” It is **traceable research work**:

- external academic results identify their real source and failure state;
- generated claims are labelled by their evidence boundary;
- knowledge answers cite retrieved document chunks;
- agent runs show tool calls, observations, status, and final result;
- collaborative actions have a durable activity history.

## Target users

- undergraduate and postgraduate students coordinating a research project;
- small research groups managing a shared reading list and document corpus;
- engineering teams conducting literature reviews or technical investigations;
- portfolio reviewers evaluating the author's ability to design an honest, explainable full-stack AI system.

The first release is optimized for small teams and demonstrable workflows, not enterprise administration.

## Core user problems

1. Papers, notes, files, and discussions are scattered across unrelated tools.
2. Teams lose the relationship between a conclusion and the source that supports it.
3. Paper search metadata, abstract-based summaries, and full-document analysis are often conflated.
4. AI task interfaces hide whether tools actually ran and what evidence was observed.
5. Collaboration state is hard to follow without a coherent space and activity model.

## Final information architecture

The proposed top-level grouping is sound, with one important refinement: Chat and Members should be scoped to a selected Research Space instead of behaving as unrelated global destinations. Paper Detail and Execution Trace are detail routes, not permanent navigation items.

```text
ResearchWeave
├─ Overview
├─ Collaboration
│  ├─ Research Spaces
│  │  └─ Space Detail: Overview | Chat | Members
│  └─ Connections
├─ Knowledge
│  ├─ Documents
│  ├─ Knowledge Bases
│  └─ Ask Knowledge
├─ Research
│  ├─ Paper Search
│  ├─ Saved Papers
│  ├─ Paper Detail (route)
│  └─ Paper Comparison
├─ Agents
│  ├─ Agents
│  ├─ Tasks
│  └─ Task Run / Execution Trace (route)
├─ Activity
└─ Settings
```

This keeps the requested product areas while avoiding global Chat/Members pages that lack space context. “Saved Papers” is useful because discovery needs a durable hand-off into Knowledge; it does not create a new top-level domain.

## Domain boundaries

- **Collaboration** answers: who is working together, in which Research Space, and what are they discussing?
- **Research** answers: what external papers exist and what can be concluded from their available metadata/abstract?
- **Knowledge** answers: which imported full documents have been parsed and indexed, and what grounded answers can be retrieved from them?
- **Agents** answers: what bounded task was requested, which existing services/tools ran, and what trace/result was produced?
- **Activity** answers: what important user/system events occurred across those domains?

Research and Knowledge remain separate because a search result is external metadata, while a knowledge document is an owned, ingested, versioned source. A paper becomes eligible for full-document grounded analysis only after its PDF is explicitly imported and successfully indexed.

## Main user workflows

### Research workflow

```text
Search real arXiv metadata
→ Inspect paper metadata and abstract
→ Generate an explicitly labelled abstract-based summary (optional)
→ Save paper to a Research Space
→ Import PDF into a Knowledge Base (explicit action)
→ Parse and index successfully
→ Ask grounded questions with citations
→ Compare selected evidence or papers
→ Run a bounded agent task using the same services
```

An arXiv failure ends in an error state with retry guidance. It never creates fallback papers. “Full-document grounded analysis” is shown only after the document indexing state is `ready`.

### Collaboration workflow

```text
Create Research Space
→ Invite an existing connection
→ Member accepts/joins
→ Open space Chat
→ Exchange messages and share paper/document references
→ Observe presence and durable activity
```

### Knowledge workflow

```text
Upload PDF / Markdown / TXT
→ Validate file
→ Parse text
→ Chunk with stable locations and metadata
→ Embed chunks
→ Add to Knowledge Base index
→ Ask question
→ Retrieve top-k filtered chunks
→ Build bounded context
→ Generate grounded answer
→ Display citations linked to source locations
```

### Agent workflow

```text
Choose Agent definition
→ Enter bounded task and scope (space / knowledge base)
→ Create durable task run
→ Router selects an allowed tool
→ Tool calls an existing application service
→ Observation is recorded
→ Agent chooses next step within limits
→ Final result and citations are recorded
→ User inspects Execution Trace
```

## Page responsibilities

| Page | Responsibility | Explicitly not responsible for |
|---|---|---|
| Overview | Recent spaces, indexing/task status, saved items, and verifiable activity summaries. | Invented metrics or fake throughput. |
| Research Spaces | List/create spaces and show user's membership. | Chat data for every space at once. |
| Space Detail | Space context, linked knowledge bases/papers, Chat, Members tabs. | Global account administration. |
| Connections | Request, accept, reject, and remove user-to-user connections. | Space membership authorization. |
| Documents | Upload, inspect metadata, see parsing/index status, retry/reindex/delete. | Claiming analysis before indexing. |
| Knowledge Bases | Group documents and define retrieval scope. | Owning LLM provider secrets. |
| Ask Knowledge | Ask within selected knowledge base; show answer, citations, and no-result state. | General ungrounded chat disguised as RAG. |
| Paper Search | Query arXiv and show real response/failure state. | Fake offline papers. |
| Paper Detail | Metadata, abstract, source links, saved/import state, abstract-based summary. | Full-document claims unless indexed. |
| Paper Comparison | Compare selected metadata/abstracts or indexed evidence with visible scope labels. | Comparing unavailable full text. |
| Agents | Agent purpose, allowed tools, limits, and recent runs. | Implementing tool business logic. |
| Tasks | Create/filter task runs and show durable status. | Timer-based simulated completion. |
| Execution Trace | Ordered steps, tool name, redacted input, observation, timing, errors, citations, final result. | Hidden chain-of-thought. Store operational trace, not private model reasoning. |
| Activity | Unified, filterable domain events relevant to the user/space. | Raw security secrets or complete sensitive payloads. |
| Settings | Profile and safe user preferences. | API keys, arbitrary provider endpoints, or authorization policy. |

## Navigation principles

- Use a conventional persistent sidebar and URL routes; no game hotbar or fake terminal navigation.
- Preserve context: when a user enters a space, its name and membership scope remain visible.
- Keep primary navigation stable; use tabs for Space Detail and detail routes for Paper/Trace.
- Distinguish external discovery, saved metadata, imported documents, and indexed knowledge with clear badges and language.
- Every AI result displays its evidence scope: `Abstract-based`, `Knowledge-base grounded`, or `Ungrounded` where explicitly allowed.
- Deep links must restore the same page and selected resource after refresh, subject to authorization.

## State and truthfulness principles

### Empty states

Explain why the collection is empty and offer one real next action. Do not seed production-looking sample papers, agents, documents, or metrics into normal user state. Demo data, if later needed, must be explicitly labelled and isolated behind a demo mode.

### Loading states

Reflect an actual pending operation. For durable work such as indexing or agent execution, show the persisted job status and last update rather than an invented percentage. Use indeterminate progress unless the backend provides measurable stages.

### Error states

Name the failed boundary (`arXiv unavailable`, `document parsing failed`, `embedding provider error`) and provide a safe retry path. Never transform failure into `success: true` or fabricated output.

### Partial states

Surface partial progress honestly: a document can be uploaded but not parsed; parsed but not embedded; an agent run can fail after two successful tools. Preserve completed evidence and a structured error without claiming overall success.

## Product scope guardrails

The first portfolio release excludes OCR, image understanding, multimodal documents, complex PDF layout/table extraction, multi-agent swarms, MCP, autonomous long-running networks, microservices, Kafka, Kubernetes, enterprise billing, and complex RBAC.

The intended permission model is simple and explainable: authenticated user; Research Space owner/member; resource ownership inherited from space membership; server-enforced checks on every request and subscription.

## Key product decisions and rationale

| Decision | Rationale |
|---|---|
| Research Space is the collaboration boundary | Chat, members, saved papers, knowledge bases, tasks, and activity need one understandable scope. |
| Research and Knowledge are separate | External metadata/abstract discovery is not equivalent to possessing and indexing full text. |
| REST plus WebSocket | REST fits durable resource operations and history; WebSocket fits live messages, presence, and status notifications. |
| Abstract summaries are labelled | The model cannot claim experimental detail it has not received. |
| Agents call tools that call services | The application has one implementation of arXiv, retrieval, documents, and comparison; Agent is orchestration, not duplicate business logic. |
| One modular monolith | The workload and team size do not justify distributed systems; module boundaries remain interview-friendly and testable. |
| No multi-agent system initially | Four deterministic tools and one bounded loop are sufficient to demonstrate real tool calling and traceability. |
