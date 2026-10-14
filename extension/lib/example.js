// Made-up graph for the "Try an example" button: two friend groups (school, work), one
// person bridging them, a one-way fan, and an account that only follows "you" (hidden
// as a loner). Links read "source follows target".
const followsYou = ['ana', 'bruno', 'caro', 'dani', 'eli', 'fede', 'gabi', 'hugo', 'iara', 'juli'];
const pairs = [
  // school: mostly mutual
  ['ana', 'bruno'], ['bruno', 'ana'],
  ['ana', 'caro'], ['caro', 'ana'],
  ['bruno', 'caro'], ['caro', 'bruno'],
  ['caro', 'dani'], ['dani', 'caro'],
  ['dani', 'ana'],
  ['bruno', 'dani'],
  // work
  ['eli', 'fede'], ['fede', 'eli'],
  ['fede', 'gabi'], ['gabi', 'fede'],
  ['gabi', 'eli'],
  // hugo knows both groups
  ['hugo', 'ana'], ['ana', 'hugo'],
  ['hugo', 'eli'], ['eli', 'hugo'],
  ['hugo', 'fede'],
  ['caro', 'hugo'],
  // iara follows people who do not follow back
  ['iara', 'ana'],
  ['iara', 'hugo'],
];

export const EXAMPLE_GRAPH = {
  username: 'you',
  metadata: { loggedUsername: 'you', generatedBy: 'example' },
  nodes: ['you', ...followsYou].map((id) => ({ id, group: 1 })),
  links: [...followsYou.map((id) => [id, 'you']), ...pairs].map(([source, target]) => ({
    source,
    target,
    value: 1,
  })),
};
