import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";

import { Brand } from "../../../components/brand";

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <main className="rw-auth-page">
      <div className="rw-auth-page__context" aria-hidden="true">
        <span className="rw-auth-page__index">01</span>
        <div>
          <p>Shared research context</p>
          <h2>Keep the work legible.</h2>
          <span>Structured spaces for teams who need a durable research record.</span>
        </div>
      </div>
      <section className="rw-auth-panel">
        <header><Brand /></header>
        {children}
        <footer>
          <span>ResearchWeave</span>
          <Link to="/">Secure workspace access</Link>
        </footer>
      </section>
    </main>
  );
}
