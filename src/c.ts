function g1(x: number) {
  let y = 0;
  const array = ["hello"];
  match<number, void>(x)
    .case<1>(() => (y = 1))
    .default(() => array.push("world"));
  console.log(y, array);
}
