import { useStore } from "./store";
import { useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { PopoverPanel } from "./components/PopoverPanel";

function App() {
  useAuth();
  const { isAuthenticated } = useStore();

  return (
    <div className="h-full">
      {isAuthenticated ? <PopoverPanel /> : <AuthScreen />}
    </div>
  );
}

export default App;
