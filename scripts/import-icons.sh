#!/usr/bin/env bash

input_dir=~/ins/factorio-2-73-ab/script-output

cp "${input_dir}"/icons-*.json src/assets/

for input in "$input_dir"/icons-*.png; do
  name=${input##*/}
  name=${name%.png}
  avifenc -s 0 -q 50 --qalpha 20 "$input" "src/assets/$name.avif"
done
