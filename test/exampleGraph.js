// Made-up graph the tests use (it was the site's "Try an example"): three friend groups (school, work,
// family) big enough to get colours, people who bridge them, a fan nobody follows back,
// and an account that only follows "you" (hidden as a loner). Links read "source follows
// target".
const groups = {
  school: ['ana', 'bruno', 'caro', 'dani', 'emi', 'feli', 'gael'],
  work: ['hugo', 'iara', 'joaco', 'kari', 'lu', 'maite'],
  family: ['nora', 'oto', 'pia', 'quique', 'rami'],
};

const pairs = [];
// inside a group most people follow each other; a few follows go one way only
for (const members of Object.values(groups)) {
  members.forEach((a, i) =>
    members.forEach((b, j) => {
      if (j <= i) return;
      const kind = (i + j) % 5;
      if (kind === 4) return; // these two don't follow each other
      pairs.push([a, b]);
      if (kind !== 3) pairs.push([b, a]); // kind 3: one way only
    })
  );
}
pairs.push(
  // hugo went to school with ana and bruno
  ['hugo', 'ana'], ['ana', 'hugo'], ['hugo', 'bruno'],
  // caro and kari met at a party
  ['caro', 'kari'], ['kari', 'caro'],
  // dani is nora's cousin
  ['dani', 'nora'], ['nora', 'dani'], ['oto', 'dani'],
  // sol follows a few people, nobody follows back
  ['sol', 'ana'], ['sol', 'hugo'], ['sol', 'kari'], ['sol', 'pia']
);

const everyone = [...Object.values(groups).flat(), 'sol', 'tomi'];
// everyone follows you; you follow back all but the fan and the loner
const withYou = [
  ...everyone.map((id) => [id, 'you']),
  ...everyone.filter((id) => !['sol', 'tomi', 'gael', 'maite'].includes(id)).map((id) => ['you', id]),
];

export const EXAMPLE_GRAPH = {
  username: 'you',
  metadata: { loggedUsername: 'you', generatedBy: 'example' },
  nodes: ['you', ...everyone].map((id) => ({ id, group: 1 })),
  links: [...withYou, ...pairs].map(([source, target]) => ({ source, target, value: 1 })),
};
