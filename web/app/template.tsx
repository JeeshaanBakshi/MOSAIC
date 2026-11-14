// A template re-mounts on every navigation (a layout does not). The page eases in: a quiet route transition.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="fade-in">{children}</div>;
}
