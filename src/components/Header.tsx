import { Link } from "@tanstack/react-router";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";

const linkClass = "text-sm text-neutral-700 hover:text-neutral-900 hover:underline";
const activeLinkClass = "text-sm font-semibold text-neutral-900 underline";

export default function Header() {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
        <Link to="/" className="text-base font-semibold text-neutral-900">
          Course Platform
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/courses" className={linkClass} activeProps={{ className: activeLinkClass }}>
            Courses
          </Link>
          <Link to="/my-courses" className={linkClass} activeProps={{ className: activeLinkClass }}>
            My courses
          </Link>
          <Link to="/dashboard" className={linkClass} activeProps={{ className: activeLinkClass }}>
            Dashboard
          </Link>
          <Link to="/admin" className={linkClass} activeProps={{ className: activeLinkClass }}>
            Admin
          </Link>
          <Link
            to="/platform-admin"
            className={linkClass}
            activeProps={{ className: activeLinkClass }}
          >
            Platform admin
          </Link>
        </div>
        <div className="ml-auto">
          <BetterAuthHeader />
        </div>
      </nav>
    </header>
  );
}
