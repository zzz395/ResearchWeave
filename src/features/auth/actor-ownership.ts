export interface ActorOwnershipSnapshot {
  readonly actorId: string | null;
  readonly generation: number;
  readonly signal: AbortSignal;
}

class ActorOwnership {
  private controller = new AbortController();
  private snapshot: ActorOwnershipSnapshot = {
    actorId: null,
    generation: 0,
    signal: this.controller.signal,
  };

  current(): ActorOwnershipSnapshot {
    return this.snapshot;
  }

  transition(actorId: string | null): { changed: boolean; snapshot: ActorOwnershipSnapshot } {
    if (actorId === this.snapshot.actorId) {
      return { changed: false, snapshot: this.snapshot };
    }

    this.controller.abort(new DOMException("Actor lifetime retired.", "AbortError"));
    this.controller = new AbortController();
    this.snapshot = {
      actorId,
      generation: this.snapshot.generation + 1,
      signal: this.controller.signal,
    };
    return { changed: true, snapshot: this.snapshot };
  }

  owns(snapshot: ActorOwnershipSnapshot): boolean {
    return !snapshot.signal.aborted
      && snapshot.actorId === this.snapshot.actorId
      && snapshot.generation === this.snapshot.generation;
  }

  ownsGeneration(actorId: string | null, generation: number): boolean {
    return !this.snapshot.signal.aborted
      && actorId === this.snapshot.actorId
      && generation === this.snapshot.generation;
  }
}

export const actorOwnership = new ActorOwnership();
