#!/usr/bin/env bash

input_dir=~/ins/factorio-2-73-ab/script-output

cp "${input_dir}"/icons-*.json src/assets/dataset/bobang/

for input in "$input_dir"/icons-*.png; do
  name=${input##*/}
  name=${name%.png}
  avifenc -s 0 -q 50 --qalpha 20 "$input" "src/assets/dataset/bobang/$name.avif"
done
