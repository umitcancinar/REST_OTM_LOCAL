import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ProblemBand } from "@/components/ProblemBand";
import { FeatureGrid } from "@/components/FeatureGrid";
import { ProductShowcase } from "@/components/ProductShowcase";
import { HowItWorks } from "@/components/HowItWorks";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { SecuritySection } from "@/components/SecuritySection";
import { PackagesSection } from "@/components/PackagesSection";
import { TrustSection } from "@/components/TrustSection";
import { DemoSection } from "@/components/DemoSection";
import { FAQ } from "@/components/FAQ";
import { FinalCta } from "@/components/FinalCta";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main>
      <Nav />
      <Hero />
      <ProblemBand />
      <FeatureGrid />
      <ProductShowcase />
      <HowItWorks />
      <ArchitectureDiagram />
      <SecuritySection />
      <PackagesSection />
      <TrustSection />
      <DemoSection />
      <FAQ />
      <FinalCta />
      <Footer />
    </main>
  );
}
