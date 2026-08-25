import { useSpaceLayout } from "../components/space-layout-context";
import { formatResearchDate } from "../format-research-date";

export function Component() {
  const space = useSpaceLayout();
  return (
    <section className="rw-record-panel rw-space-tab-panel">
      <div className="rw-record-panel__heading">
        <p className="rw-page-kicker">Space record</p>
        <span className="rw-role-badge">{space.role}</span>
      </div>
      <dl className="rw-definition-grid">
        <div><dt>Your role</dt><dd>{space.role === "owner" ? "Owner" : "Member"}</dd></div>
        <div><dt>Created</dt><dd><time dateTime={space.createdAt}>{formatResearchDate(space.createdAt)}</time></dd></div>
        <div><dt>Last updated</dt><dd><time dateTime={space.updatedAt}>{formatResearchDate(space.updatedAt)}</time></dd></div>
        <div><dt>Space ID</dt><dd className="rw-mono">{space.id}</dd></div>
      </dl>
    </section>
  );
}
