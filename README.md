# ResearchWeave

**Real-Time Research Collaboration & RAG Agent Platform**

ResearchWeave is a planned research and engineering SaaS application that brings collaborative research spaces, real-time discussion, document knowledge bases, grounded retrieval-augmented generation, arXiv discovery, paper comparison, and tool-calling research agents into one coherent product.

## Current status

ResearchWeave is in the **architecture and legacy-audit stage**. This repository currently contains design documentation only; application, authentication, RAG, agent, database, WebSocket, arXiv, and LLM features have not yet been implemented here.

## Planned core capabilities

- Research Spaces with members, connections, and real-time chat
- PDF, Markdown, and TXT document ingestion into knowledge bases
- Grounded knowledge questions with retrievable source citations
- Real arXiv paper search and clearly labelled abstract-based summaries
- Paper inspection, saving, and comparison
- Tool-calling research agents with durable task status and execution traces
- A unified activity history across collaboration, knowledge, research, and agents

## Architecture documentation

- [Legacy audit](docs/architecture/legacy-audit.md)
- [Product architecture](docs/architecture/product-architecture.md)
- [Technical architecture](docs/architecture/technical-architecture.md)
- [Migration map](docs/architecture/migration-map.md)
- [Implementation roadmap](docs/architecture/implementation-roadmap.md)

## Project origin

**Original Team Project:**

[CommandBlock-Nexus](https://github.com/HereWeThink/CommandBlock-Nexus)

ResearchWeave is an independent post-project redesign and extension of the original team project. It is a new product architecture rather than a rename, visual reskin, or mechanical refactor. Future implementation may selectively adapt useful ideas or code from CommandBlock-Nexus—such as room-based real-time communication, API integration patterns, or arXiv metadata parsing—only after security, correctness, licensing, and architectural review.

Accordingly, ResearchWeave should not be described as “built completely from scratch” if any legacy implementation is later reused. Its accurate provenance is: an independent redesign and extension informed by the original team project, with selective reuse decisions documented in this repository.
