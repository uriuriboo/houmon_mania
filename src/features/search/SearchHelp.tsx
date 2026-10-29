/** 検索構文のヘルプ(9.3.1) */
export function SearchHelpContent() {
  return (
    <div className="prose-ja space-y-3">
      <table className="[&_td:first-child]:whitespace-nowrap">
        <thead>
          <tr>
            <th>書き方</th>
            <th>意味</th>
            <th>例</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>語 語</code>
            </td>
            <td>どちらも含む(AND)</td>
            <td>
              <code>ラーメン 渋谷</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>A AND B</code>
            </td>
            <td>どちらも含む</td>
            <td>
              <code>ラーメン AND 渋谷</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>A OR B</code>
            </td>
            <td>どちらかを含む</td>
            <td>
              <code>一蘭 OR 二郎</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>( )</code>
            </td>
            <td>まとめる(入れ子も可)。括弧の前後に空白を入れる</td>
            <td>
              <code>替え玉 AND ( 一蘭 OR 二郎 )</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>&quot;…&quot;</code>
            </td>
            <td>空白・記号・AND / OR を含む語をそのまま探す</td>
            <td>
              <code>&quot;H&amp;M&quot;</code> <code>&quot;12:30&quot;</code>
            </td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          検索の対象は <strong>店名(英語表記・現地語)・コメント・場所名・イベント名</strong> です。住所・カテゴリはエクスポートに含まれないため検索できません(例:「カフェ」で店名にカフェと付かない店は見つかりません)。
        </li>
        <li>各語は部分一致です。全角/半角、大文字/小文字は区別しません。ひらがなとカタカナは区別します。</li>
        <li>
          AND / OR は大文字で入力します。AND と OR を混ぜるときは括弧でまとめてください(例: <code>ラーメン AND ( 渋谷 OR 新宿 )</code>)。
        </li>
        <li>除外(NOT・-)、ワイルドカード(*)、項目の指定(venue:…)には対応していません。部分一致なので * は不要です。</li>
        <li>何も入力せずに検索すると、すべてのチェックインを新しい順に表示します。</li>
        <li>
          「詳細条件」で、チェックイン日・曜日・時間帯・写真やコメントの有無・イベント・公開範囲・同じ店への訪問回数で絞り込めます。検索式と組み合わせることも、検索式なしで使うこともできます。日付・曜日・時間帯はチェックインした場所の現地時刻で判定します。
        </li>
        <li>上限: 200 文字・1 語 50 文字・10 語・括弧 5 段まで。</li>
      </ul>
    </div>
  );
}
