// Successive shortest path (Bellman-Ford/SPFA), stops when the cheapest augmenting path is no longer profitable (cost >= 0).
export class Flow {
  constructor(n) { this.n = n; this.g = Array.from({ length: n }, () => []); this.e = []; }
  add(u, v, cap, cost) {
    this.g[u].push(this.e.length); this.e.push({ to: v, cap, cost, flow: 0 });
    this.g[v].push(this.e.length); this.e.push({ to: u, cap: 0, cost: -cost, flow: 0 });
    return this.e.length - 2;
  }
  run(s, t) {
    const { n, g, e } = this;
    for (let guard = 0; guard < 100000; guard++) {
      const dist = new Array(n).fill(Infinity), inq = new Array(n).fill(false), prev = new Array(n).fill(-1);
      dist[s] = 0; const q = [s];
      while (q.length) {
        const u = q.shift(); inq[u] = false;
        for (const id of g[u]) {
          const ed = e[id];
          if (ed.cap - ed.flow > 1e-9 && dist[u] + ed.cost < dist[ed.to] - 1e-12) {
            dist[ed.to] = dist[u] + ed.cost; prev[ed.to] = id;
            if (!inq[ed.to]) { inq[ed.to] = true; q.push(ed.to); }
          }
        }
      }
      if (dist[t] === Infinity || dist[t] >= -1e-9) return;
      let push = Infinity;
      for (let v = t; v !== s; v = e[prev[v] ^ 1].to) push = Math.min(push, e[prev[v]].cap - e[prev[v]].flow);
      for (let v = t; v !== s; v = e[prev[v] ^ 1].to) { e[prev[v]].flow += push; e[prev[v] ^ 1].flow -= push; }
    }
  }
}
