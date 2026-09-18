"""Rellena la plantilla del issue del guardián de `main` (F0.7).

Lo hace Python y no `sed` ni el propio shell porque el mensaje de un commit es
texto escrito por un tercero: expandido por el shell, un `$(...)` se ejecutaría
en el runner. Aquí los valores entran por el entorno y nunca se interpretan.
"""

import os

PLANTILLA = '.github/plantillas/guardian-main.md'
SALIDA = 'cuerpo.md'

with open(PLANTILLA, encoding='utf8') as fichero:
    cuerpo = fichero.read()

sha = os.environ['SHA']
valores = {
    '__MOTIVO__': os.environ.get('motivo') or 'Commit en `main` sin PR.',
    '__SHA__': sha,
    '__SHA_CORTO__': sha[:7],
    '__SERVIDOR__': os.environ['SERVIDOR'],
    '__REPO__': os.environ['REPO'],
    '__AUTOR__': os.environ.get('AUTOR') or '(desconocido)',
    '__PUSHER__': os.environ.get('PUSHER') or '(desconocido)',
    '__EJECUCION__': os.environ['EJECUCION'],
    # El mensaje va dentro de un bloque de código: se neutralizan las comillas
    # invertidas para que no pueda cerrarlo y escapar a markdown.
    '__MENSAJE__': (os.environ.get('MENSAJE') or '').replace('`', "'"),
}

for marca, valor in valores.items():
    cuerpo = cuerpo.replace(marca, valor)

with open(SALIDA, 'w', encoding='utf8') as fichero:
    fichero.write(cuerpo)

print(f'Cuerpo del issue escrito en {SALIDA} ({len(cuerpo)} caracteres).')
