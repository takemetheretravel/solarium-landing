"use client";

import { useState } from "react";
import { Cpu, Heart, Mountain, UtensilsCrossed, Check, ChevronDown } from "lucide-react";
import type { AmenityGroup } from "@/config/properties";

const ICONS = { Cpu, Heart, Mountain, UtensilsCrossed } as const;

type Props = {
  groups: AmenityGroup[];
  fullList: string[];
};

export default function AmenitiesGrouped({ groups, fullList }: Props) {
  const [showAll, setShowAll] = useState(false);

  return (
    <div>
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {groups.map((g) => {
          const Icon = ICONS[g.iconName];
          return (
            <div key={g.groupId}>
              <Icon className="h-7 w-7 text-copper" strokeWidth={1.5} />
              <h3 className="mt-5 font-serif text-2xl leading-tight text-charcoal">
                {g.title}
              </h3>
              <ul className="mt-4 space-y-2 font-sans text-sm leading-relaxed text-charcoal/75">
                {g.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span className="mt-2 h-px w-3 flex-shrink-0 bg-copper" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {fullList.length > 0 && (
        <div className="mt-12">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-2 border-b border-copper pb-1 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
          >
            {showAll ? "Esconder lista completa" : "Ver todas as comodidades"}
            <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? "rotate-180" : ""}`} />
          </button>
          {showAll && (
            <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fullList.map((a) => (
                <div
                  key={a}
                  className="flex items-center gap-3 border-b border-charcoal/5 py-2 font-sans text-sm text-charcoal/80"
                >
                  <Check className="h-3.5 w-3.5 flex-shrink-0 text-copper" strokeWidth={2} />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
