import { useLoaderData } from '@remix-run/react';
import { Recipe, Shrunk } from '~/lib/shrunk';
import { LoaderFunctionArgs } from '@remix-run/router';
import { Locales } from '~/lib/locale';
import { CraftIcon, Icons, RecipeIcon } from '~/lib/icons';
import { IconCopy, IconFlask } from '@tabler/icons-react';
import {
  ItemProductPrototype,
  ProductPrototype,
} from 'factorio-raw-types/prototypes';
import { useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { mallAssembler } from '~/lib/bp';
import { encode } from '~/lib/bp/blueprints';

async function load<T>(setId: string, thing: string) {
  const resp = await fetch(`/assets/sets/${setId}/${thing}.json`);
  return (await resp.json()) as T;
}

export const clientLoader = async (args: LoaderFunctionArgs) => {
  const setId = args.params.setId!;
  return {
    shrunk: await load<Shrunk>(setId, 'shrunk-data'),
    locales: await load<Locales>(setId, 'locales'),
    icons: await load<Icons>(setId, 'icons'),
  };
};

type Ds = Awaited<ReturnType<typeof clientLoader>>;

export default function Bp() {
  const ds: Ds = useLoaderData<typeof clientLoader>();
  const costed = useMemo(() => costs(ds), [ds]);
  return (
    <div className={'p-2'}>
      <div className={'flex flex-wrap gap-2'}>
        {Object.entries(ds.shrunk.recipes)
          .filter(([, recp]) => hasIngredients(recp) && !isVoid(recp))
          .filter(([, recp]) =>
            madeIn(ds, recp).includes('assembling-machine-2'),
          )
          .sort(([a], [b]) => (costed[a] ?? Infinity) - (costed[b] ?? Infinity))
          .map(([id, recp]) => {
            return <RecipeTile key={id} ds={ds} id={id} recp={recp} />;
          })}
      </div>
    </div>
  );
}

const costs = (ds: Ds) => {
  const computed: Record<string, number> = {
    'iron-plate': 1,
    'steel-plate': 6,
    'copper-plate': 1.2,
    stone: 4,
    coal: 4,
    water: 1,
    'iron-ore': 10,
    'petroleum-gas': 1,
  };

  for (;;) {
    let changed = false;
    for (const [id, recp] of Object.entries(ds.shrunk.recipes)) {
      if (!hasIngredients(recp)) continue;
      if (isVoid(recp)) continue;

      const cost =
        recp.ingredients.reduce(
          (acc, ing) => acc + (computed[ing.name] ?? Infinity) * ing.amount,
          0,
        ) * 1.2;

      if (cost < (computed[id] ?? Infinity)) {
        computed[id] = cost;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return computed;
};

const RecipeTile = ({ ds, id, recp }: { ds: Ds; id: string; recp: Recipe }) => (
  <div className={'w-48'}>
    <div className={'font-bold text-nowrap'}>
      <div className={'overflow-clip w-full'}>
        <RecipeIcon ds={ds} name={id} alt={id} /> {ds.locales.recipe.names[id]}{' '}
      </div>
    </div>
    <div className={'flex flex-wrap gap-x-2'}>
      {(recp.ingredients ?? []).map((ing, i) => {
        const icon = <CraftIcon ds={ds} name={ing.name} alt={ing.name} />;
        return (
          <div
            key={i}
            className={twMerge(
              'text-nowrap',
              ing.type === 'fluid' ? 'bg-red-800 rounded px-1' : '',
            )}
          >
            {ing.amount} &times;{icon}
          </div>
        );
      })}
    </div>
    <div className={'flex flex-wrap gap-x-2'}>
      &rArr;
      {(recp.results ?? []).map((prod, i) => (
        <div key={i}>
          <Product ds={ds} prod={prod} />
        </div>
      ))}
    </div>
    <div className={'flex'}>
      <CopyButton
        text={encode(
          mallAssembler(
            id,
            recp.main_product ??
              (recp.results![0] as ItemProductPrototype).name,
            undefined,
            Object.fromEntries(
              (recp.ingredients ?? []).map((ing) => [ing.name, ing.amount]),
            ),
          ),
        )}
      />
      {madeIn(ds, recp).map((id, i) => (
        <CraftIcon ds={ds} name={id} key={i} alt={id} />
      ))}
      <span>&times; {recp.energy_required ?? 0.5}s</span>
    </div>
  </div>
);

type WithRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

const Product = ({ ds, prod }: { ds: Ds; prod: ProductPrototype }) => {
  switch (prod.type) {
    case 'item':
    case 'fluid': {
      const amount = (prod.amount ?? 1) * (prod.probability ?? 1);
      const icon = (
        <CraftIcon
          ds={ds}
          name={prod.name}
          alt={`${prod.name} @ ${prod.probability}`}
        />
      );
      if (amount === 1) return icon;
      return (
        <div>
          {amount} &times;{icon}
        </div>
      );
    }
    case 'research-progress':
      return (
        <div>
          {prod.amount} &times;
          <IconFlask className={'inline'} /> {prod.research_item}
        </div>
      );
  }
};

function madeIn(ds: Ds, recp: Recipe) {
  return Object.entries(ds.shrunk.crafting)
    .filter(([, c]) =>
      c.crafting_categories.includes(recp.category ?? 'crafting'),
    )
    .map(([id]) => id);
}

function hasIngredients(
  recp: Recipe,
): recp is WithRequired<Recipe, 'ingredients'> {
  return (recp.ingredients?.length ?? 0) > 0;
}

function isVoid(recp: Recipe) {
  if (!hasIngredients(recp)) return false;
  if (recp.ingredients.length !== 1) return false;
  if (recp.results?.length !== 1) return false;

  const ing = recp.ingredients[0];
  const prod = recp.results[0];
  if (prod.type === 'research-progress') return false;
  if (ing.name !== prod.name) return false;
  if (ing.amount > (prod.amount ?? 1)) return false;
  if ((prod.probability ?? 1) >= 1) return false;

  return true;
}

const CopyButton = (props: { text: string; title?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={'mx-2 hover:text-blue-500 whitespace-nowrap'}
      title={props.title}
      onClick={async () => {
        await navigator.clipboard.writeText(props.text);
        setCopied(true);
      }}
      onMouseLeave={() => setCopied(false)}
    >
      <IconCopy />
      {copied ? ' copied!' : ''}
    </button>
  );
};
