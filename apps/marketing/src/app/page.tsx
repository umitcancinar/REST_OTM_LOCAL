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
import { ScrollProgress } from "@/components/ScrollProgress";

export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string; message?: string }> }) {
  const params = await searchParams;
  const demoStage = params.demo === "verify" || params.demo === "success" || params.demo === "error" ? params.demo : "form";
  return (
    <main>
      <ScrollProgress />
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
      <DemoSection stage={demoStage} message={params.message} />
      <FAQ />
      <FinalCta />
      <Footer />
    </main>
  );
}
