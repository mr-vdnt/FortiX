sed -i '1i import { Login } from "./components/Login.js";' src/App.tsx
sed -i 's/export default function App() {/export default function App() {\n  const [isAuthenticated, setIsAuthenticated] = React.useState(!!localStorage.getItem("fortix_token"));\n  if (!isAuthenticated) return <Login onLogin={() => setIsAuthenticated(true)} \/>;\n/g' src/App.tsx
