export type Icons = Record<string, [number, number]>;

export const RecipeIcon = (props: {
  ds: { icons: Icons };
  name: string;
  alt: string;
}) => {
  let found: [number, number] | undefined =
    props.ds.icons[`recipe:${props.name}`];
  if (!found) {
    found = props.ds.icons['craft:solid-fuel'];
  }
  return (
    <span
      className="icon-sprite"
      title={props.alt}
      style={{
        backgroundImage: `url("/sets/space-age/icons.webp")`,
        backgroundPosition: `-${found[0]}px -${found[1]}px`,
      }}
    />
  );
};

export const CraftIcon = (props: {
  ds: { icons: Icons };
  name: string;
  alt: string;
}) => {
  let found: [number, number] | undefined =
    props.ds.icons[`craft:${props.name}`];
  if (!found) {
    found = props.ds.icons['craft:solid-fuel'];
  }
  return (
    <span
      className="icon-sprite"
      title={props.alt}
      style={{
        backgroundImage: `url("/sets/space-age/icons.webp")`,
        backgroundPosition: `-${found[0]}px -${found[1]}px`,
      }}
    />
  );
};
