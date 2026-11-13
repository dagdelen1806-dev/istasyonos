import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import StationApp from "./pages/StationApp";
import NotFound from "./pages/NotFound";
import "./station.css";

const routes = [
  "/",
  "/vardiyalar",
  "/mobil/pompaci",
  "/sayaclar",
  "/icmal",
  "/tanklar",
  "/tank-dogrulama",
  "/gunluk-rapor",
  "/tanker-belge",
  "/slipler",
  "/muhasebe",
  "/market",
  "/satinalma",
  "/cari",
  "/finans",
  "/kurulum",
  "/entegrasyon",
  "/denetim",
  "/asistan",
  "/profil",
  "/personel",
];
export default function App() {
  const [location] = useLocation();
  useEffect(() => {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = location.split("?")[0] === "/mobil/pompaci" ? "/pompaci.webmanifest" : "/manifest.webmanifest";
  }, [location]);
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
