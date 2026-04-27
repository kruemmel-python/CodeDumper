import React from 'react';
import { useTranslation } from '../i18n';
import { Select } from './ui/Select';

export const LanguageSelector: React.FC = () => {
    const { language, setLanguage, t } = useTranslation();

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setLanguage(event.target.value as typeof language);
    };

    return (
        <div className="flex items-center gap-3 justify-center lg:justify-end">
            <label htmlFor="language-select" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('language.selector')}
            </label>
            <div className="w-36">
                <Select
                    id="language-select"
                    value={language}
                    onChange={handleChange}
                >
                    <option value="en">{t('language.en')}</option>
                    <option value="de">{t('language.de')}</option>
                </Select>
            </div>
            
        </div>
    );
};
