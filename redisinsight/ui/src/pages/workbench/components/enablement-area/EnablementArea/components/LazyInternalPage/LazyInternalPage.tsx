import React, { useEffect, useState } from 'react'
import { startCase } from 'lodash'
import { useHistory } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import axios from 'axios'

import { getApiErrorMessage, isStatusSuccessful, Nullable } from 'uiSrc/utils'
import { resourcesService } from 'uiSrc/services'
import { IS_ABSOLUTE_PATH } from 'uiSrc/constants/regex'
import { ApiEndpoints } from 'uiSrc/constants'
import {
  resetWorkbenchEASearch,
  appContextWorkbenchEA,
  setWorkbenchEAItemScrollTop, setWorkbenchEASearch
} from 'uiSrc/slices/app/context'
import { IEnablementAreaItem } from 'uiSrc/slices/interfaces'
import { workbenchGuidesSelector } from 'uiSrc/slices/workbench/wb-guides'
import { workbenchTutorialsSelector } from 'uiSrc/slices/workbench/wb-tutorials'

import { workbenchCustomTutorialsSelector } from 'uiSrc/slices/workbench/wb-custom-tutorials'
import InternalPage from '../InternalPage'
import { getFileInfo, getPagesInsideGroup, IFileInfo } from '../../utils/getFileInfo'
import FormatSelector from '../../utils/formatter/FormatSelector'

interface IPageData extends IFileInfo {
  content: string;
  relatedPages?: IEnablementAreaItem[];
}
const DEFAULT_PAGE_DATA = { content: '', name: '', parent: '', extension: '', location: '', relatedPages: [] }

export interface Props {
  onClose: () => void
  title?: string
  path: string
  manifestPath?: Nullable<string>
  sourcePath: string
  search: string
}

const LazyInternalPage = ({ onClose, title, path, sourcePath, manifestPath, search }: Props) => {
  const history = useHistory()
  const { itemScrollTop } = useSelector(appContextWorkbenchEA)
  const guides = useSelector(workbenchGuidesSelector)
  const tutorials = useSelector(workbenchTutorialsSelector)
  const customTutorials = useSelector(workbenchCustomTutorialsSelector)
  const [isLoading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [pageData, setPageData] = useState<IPageData>(DEFAULT_PAGE_DATA)
  const dispatch = useDispatch()
  const fetchService = IS_ABSOLUTE_PATH.test(path) ? axios : resourcesService

  const getRelatedPages = (sourcePath: string): IEnablementAreaItem[] => {
    switch (sourcePath) {
      case ApiEndpoints.GUIDES_PATH:
        return getPagesInsideGroup(guides.items, manifestPath)
      case ApiEndpoints.TUTORIALS_PATH:
        return getPagesInsideGroup(tutorials.items, manifestPath)
      case ApiEndpoints.CUSTOM_TUTORIALS_PATH:
        return getPagesInsideGroup(customTutorials.items, manifestPath)
      default:
        return []
    }
  }

  const loadContent = async () => {
    setLoading(true)
    setError('')

    const pageInfo = getFileInfo(path)
    const relatedPages = getRelatedPages(sourcePath)
    setPageData({ ...DEFAULT_PAGE_DATA, ...pageInfo, relatedPages })

    try {
      const formatter = FormatSelector.selectFor(pageInfo.extension)
      const { data, status } = await fetchService.get<string>(path)
      if (isStatusSuccessful(status)) {
        dispatch(setWorkbenchEASearch(search))
        const contentData = await formatter.format(data, { history })
        setPageData((prevState) => ({ ...prevState, content: contentData }))
        setLoading(false)
      }
    } catch (error) {
      setLoading(false)
      const errorMessage: string = getApiErrorMessage(error)
      dispatch(resetWorkbenchEASearch())
      setError(errorMessage)
    }
  }

  useEffect(() => {
    const startLoadContent = async () => {
      if (!guides.loading && !tutorials.loading) {
        await loadContent()
      }
    }
    startLoadContent()
  }, [path, sourcePath, guides.loading, tutorials.loading])

  const handlePageScroll = (top: number) => {
    dispatch(setWorkbenchEAItemScrollTop(top))
  }

  return (
    <InternalPage
      id={pageData.name}
      path={path}
      sourcePath={sourcePath}
      onClose={onClose}
      title={startCase(title || pageData.name)}
      backTitle={startCase(pageData?.parent)}
      isLoading={isLoading || guides.loading || tutorials.loading}
      content={pageData.content}
      error={error}
      onScroll={handlePageScroll}
      scrollTop={itemScrollTop}
      pagination={pageData.relatedPages}
    />
  )
}

export default LazyInternalPage
