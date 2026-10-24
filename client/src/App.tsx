import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import StationApp from "./pages/StationApp";
import NotFound from "./pages/NotFound";
import "./station.css";

const routes = [
  "/",
  "/vardiyalar",
  "/slipler",
  "/muhasebe",
  "/market",
  "/kasa",
  "/satinalma",
  "/cari",
  "/finans",
  "/raporlar",
  "/market-muhasebe",
  "/el-terminali",
  "/kurulum",
  "/entegrasyon",
  "/denetim",
  "/asistan",
];
export default function App() {
  const [location] = useLocation();
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-right" />
          {routes.includes(location.split("?")[0]) ? (
            <StationApp />
          ) : (
            <NotFound />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
