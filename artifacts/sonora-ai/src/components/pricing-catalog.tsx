import { useState } from "react";
import { CREDIT_PACKS, PLANS, PRICE_STATUS, formatUsd } from "@/lib/pricing";
import { startCheckout } from "@/lib/session-tools";

export default function PricingCatalog() {
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");

  const buy = async (sku: string) => {
    setPending(sku);
    setNotice("");
    const result = await startCheckout(sku);
    if (result === "signin") window.location.href = `${import.meta.env.BASE_URL}sign-in`;
    else if (result === "soon") setNotice("Coming soon");
    setPending("");
  };

  return (
    <div className="parity-catalog">
      <p className="parity-todo">Prices are placeholders ({PRICE_STATUS}) and are not a live offer until they are confirmed.</p>
      <div className="parity-grid">
        {PLANS.map((plan) => (
          <article key={plan.id} className="reference-plan reference-plan-free">
            <h3>{plan.name}</h3>
            <p className="reference-plan-price">{formatUsd(plan.priceCents)}</p>
            <p>Unlimited sessions for {plan.durationHours === 24 ? "24 hours" : `${Math.round(plan.durationHours / 24)} days`}.</p>
            <button type="button" className="reference-plan-action" disabled={pending === plan.id} onClick={() => void buy(plan.id)}>
              {pending === plan.id ? "Starting…" : `Buy ${plan.name}`}
            </button>
          </article>
        ))}
      </div>
      <h3 className="parity-pack-title">Credit packs</h3>
      <p>One credit covers a 30-minute block after the free tier. Blocks can auto-extend.</p>
      <div className="parity-grid">
        {CREDIT_PACKS.map((pack) => (
          <article key={pack.id} className="reference-plan reference-plan-free">
            <h3>{pack.credits} credit{pack.credits === 1 ? "" : "s"}</h3>
            <p className="reference-plan-price">{formatUsd(pack.priceCents)}</p>
            <button type="button" className="reference-plan-action" disabled={pending === pack.id} onClick={() => void buy(pack.id)}>
              {pending === pack.id ? "Starting…" : "Buy pack"}
            </button>
          </article>
        ))}
      </div>
      {notice && <p role="status" className="parity-soon">{notice}</p>}
    </div>
  );
}
