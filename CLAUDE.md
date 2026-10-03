@AGENTS.md
# Engineering & Learning Guidelines for Core Web Vitals Diagnostic Engine

## Developer Level & Goals
- The primary developer is an experienced vanilla JavaScript and Technical SEO specialist learning React and Next.js (App Router).
- The goal is to build an interview-grade, production-quality project that can be defended line-by-line in senior engineering interviews.

## Architectural & Code Rules
1. **Component Style:** Use strictly functional components and standard React hooks (`useState`, `useEffect`, `useActionState`). Never generate legacy class components.
2. **TypeScript Strictness:** Always define explicit interfaces or types. Never use `any`.
3. **Exploratory Pedagogy:** When introducing a React concept or hook, provide a concise explanation in the response comparing it directly to its vanilla JavaScript / DOM manipulation equivalent (e.g., explaining how `useState` replaces manual `element.textContent` mutations and event listeners).
4. **Design & Styling:** Use Tailwind CSS utility classes cleanly. Avoid unnecessary utility sprawl or external CSS modules unless requested.
5. **Security:** Keep all API keys server-side in Server Actions or route handlers. Never expose sensitive logic in client components.