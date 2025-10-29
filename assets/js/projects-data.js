(function(){
  'use strict';

  const defaults = {
    datapacks: [
      {
        id: 'jetpack-datapack',
        title: 'Jetpack Datapack',
        summary: 'Lightweight jetpack for survival. Vanilla-friendly, no mods required.',
        description: 'Jetpack Datapack adds a balanced flight mechanic powered by fuel crafted in survival. It is designed to feel native to Minecraft and to work on servers without mods. Highlights include compact recipes, configurable fuel costs, and zero client-side requirements.',
        image: 'assets/img/logo.jpg',
        tags: ['1.21.8', 'Survival', 'Lightweight'],
        type: 'Datapack',
        links: [
          {
            label: 'Download',
            url: 'downloads/jetpack-datapack-1.21.8.zip',
            download: true
          }
        ]
      }
    ],
    printing: [
      {
        id: 'minecraft-pickaxe-print',
        title: 'Minecraft Pickaxe',
        summary: 'A simple two-part Minecraft pickaxe desk model – prints support-free and snaps together.',
        description: 'This printable pickaxe is split into two interlocking pieces so it fits on most build plates. It requires no supports and assembles without glue. Great as a quick decoration or prop for your gaming space.',
        image: 'assets/img/logo.jpg',
        tags: ['STL', '0.2mm', 'No supports'],
        type: '3D Print',
        links: []
      }
    ]
  };

  window.MIRL_CMS = Object.assign(window.MIRL_CMS || {}, {
    DEFAULT_PROJECTS: defaults,
    PROJECTS_KEY: 'mirl.projects.v1',
    PASSWORD_KEY: 'mirl.admin.password.v1',
    DEFAULT_PASSWORD_HASH: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    DEFAULT_PASSWORD_HINT: 'admin123'
  });
})();
